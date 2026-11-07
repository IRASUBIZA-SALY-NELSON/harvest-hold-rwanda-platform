import fs from 'node:fs';
import net from 'node:net';
import tls from 'node:tls';

import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { Aedes, type Client } from 'aedes';

import { Database } from '../../common/database.service.js';
import { sha256 } from '../../common/ids.js';
import { config } from '../../config.js';
import { CommandsService, type DeviceCommand } from '../commands/commands.service.js';
import { IngestService } from '../devices/ingest.service.js';
import { type RoomRow, RoomsService } from '../rooms/rooms.service.js';

/** Topics. A controller may publish under hhr/<id>/up/ and listen under hhr/<id>/down/, nothing else. */
export const topics = {
  up: (id: string, name: string) => `hhr/${id}/up/${name}`,
  down: (id: string, name: string) => `hhr/${id}/down/${name}`,
};

const MAX_PAYLOAD = 256 * 1024;
const MAX_PER_MINUTE = 240;

interface DeviceClient extends Client {
  room?: RoomRow;
  /** The id the controller signed in with (HHR-001, or an older id): the topics use it. */
  topicId?: string;
  windowStart?: number;
  windowCount?: number;
}

/**
 * The MQTT broker. It runs inside the API and is a second road to the same place: readings go
 * through the same ingest as HTTPS, commands are pushed at once, and the controller falls back to
 * it when HTTPS does not work. A controller signs in with its room id and device token.
 */
@Injectable()
export class MqttService implements OnApplicationBootstrap, OnModuleDestroy {
  private broker: Aedes | null = null;
  private servers: (net.Server | tls.Server)[] = [];
  private readonly log = new Logger('Mqtt');
  /** canonical room id -> connected controllers */
  private clients = new Map<string, Set<DeviceClient>>();

  constructor(
    private db: Database,
    private rooms: RoomsService,
    private ingest: IngestService,
    private commands: CommandsService
  ) {}

  async onApplicationBootstrap() {
    this.commands.onCreated((roomId) => void this.push(roomId).catch((e) => this.log.warn(e.message)));
    // Tests start their own broker on a free port, so servers are not opened here.
    if (!config.mqtt.enabled || config.test) return;
    await this.start();
    if (config.mqtt.allowPlain) await this.listenPlain(config.mqtt.port, config.mqtt.host);
    if (config.mqtt.tlsCert && config.mqtt.tlsKey) await this.listenTls(config.mqtt.tlsPort, config.mqtt.host);
    if (!this.servers.length) this.log.warn('MQTT is enabled but no port is open (plain is off and there is no TLS certificate)');
  }

  async start() {
    if (this.broker) return;
    const broker = await Aedes.createBroker({ maxTopicLevels: 6, connectTimeout: 15_000 });
    this.broker = broker;
    const topicOf = (c: DeviceClient | null) => c?.topicId;

    broker.authenticate = (client: DeviceClient, username, password, done) => {
      const token = password?.toString();
      if (!username || !token) return done(Object.assign(new Error('credentials required'), { returnCode: 4 }), false);
      this.rooms
        .getRow(username)
        .then((room) => {
          if (!room.device_token_hash || room.device_token_hash !== sha256(token) || room.status === 'retired') throw new Error('bad credentials');
          client.room = room;
          client.topicId = username;
          done(null, true);
        })
        .catch(() => done(Object.assign(new Error('bad credentials'), { returnCode: 4 }), false));
    };
    broker.authorizePublish = (client: DeviceClient | null, packet, cb) => {
      const id = topicOf(client);
      if (id && packet.topic.startsWith(`hhr/${id}/up/`)) return cb(null);
      cb(new Error('not allowed'));
    };
    broker.authorizeSubscribe = (client: DeviceClient, sub, cb) => {
      const id = topicOf(client);
      if (id && (sub.topic === `hhr/${id}/down/#` || sub.topic === `hhr/${id}/down/command`)) return cb(null, sub);
      cb(null, null); // refused quietly: the controller is told "failure" for that topic and stays connected
    };

    broker.on('clientReady', (client: DeviceClient) => {
      const room = client.room;
      if (!room) return;
      if (!this.clients.has(room.id)) this.clients.set(room.id, new Set());
      this.clients.get(room.id)!.add(client);
      void this.touch(room.id);
      void this.push(room.id).catch((e) => this.log.warn(e.message));
    });
    broker.on('clientDisconnect', (client: DeviceClient) => {
      if (client.room) this.clients.get(client.room.id)?.delete(client);
    });
    broker.on('publish', (packet, client) => {
      if (!client) return; // our own pushes
      void this.onMessage(client as DeviceClient, packet.topic, packet.payload as Buffer).catch((e) => this.log.warn(`${(client as DeviceClient).topicId}: ${e.message}`));
    });
  }

  /** Opens the plain TCP port. Returns the port actually used (0 = any free port, for tests). */
  listenPlain(port: number, host = '127.0.0.1'): Promise<number> {
    return this.listen(net.createServer(this.broker!.handle), port, host, 'tcp');
  }

  listenTls(port: number, host: string): Promise<number> {
    const server = tls.createServer({ cert: fs.readFileSync(config.mqtt.tlsCert), key: fs.readFileSync(config.mqtt.tlsKey) }, this.broker!.handle);
    return this.listen(server, port, host, 'tls');
  }

  private listen(server: net.Server | tls.Server, port: number, host: string, kind: string): Promise<number> {
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        this.servers.push(server);
        const actual = (server.address() as net.AddressInfo).port;
        this.log.log(`MQTT (${kind}) listening on ${host}:${actual}`);
        resolve(actual);
      });
    });
  }

  isConnected(roomId: string) {
    return (this.clients.get(roomId)?.size ?? 0) > 0;
  }

  private async touch(roomId: string) {
    await this.db.query('UPDATE cold_rooms SET mqtt_seen_at = now() WHERE id = $1', [roomId]);
  }

  private async onMessage(client: DeviceClient, topic: string, payload: Buffer) {
    const room = client.room!;
    const now = Date.now();
    if (!client.windowStart || now - client.windowStart > 60_000) {
      client.windowStart = now;
      client.windowCount = 0;
    }
    if (++client.windowCount! > MAX_PER_MINUTE) return;
    if (payload.length > MAX_PAYLOAD) return;
    const name = topic.slice(`hhr/${client.topicId}/up/`.length);
    let body: any;
    try {
      body = JSON.parse(payload.toString('utf8') || '{}');
    } catch {
      return;
    }
    // The room may have been changed or its token rotated since sign-in.
    const current = await this.rooms.getRow(room.id).catch(() => null);
    if (!current || !current.device_token_hash || current.device_token_hash !== room.device_token_hash) return client.close();
    if (name === 'readings') {
      const result = await this.ingest.readings(current, body, 'mqtt', Number.isInteger(body?.firmware) ? body.firmware : undefined);
      void this.touch(room.id);
      // MQTT has no HTTP status: the controller keeps its readings until it hears this echo of its batch number.
      if (Number.isInteger(body?.batch)) this.sendJson(client, 'stored', { batch: body.batch, ...result });
    } else if (name === 'ack') {
      if (Number.isInteger(body?.id)) await this.commands.ack(room.id, body.id, body.ok === true, body.message);
    } else if (name === 'hello') {
      void this.touch(room.id);
      await this.push(room.id);
    }
  }

  /** Sends the controller its open commands (the controller ignores one it already carried out). */
  async push(roomId: string) {
    const clients = this.clients.get(roomId);
    if (!clients?.size) return;
    const pending = await this.commands.deliver(roomId, 'mqtt');
    for (const client of clients) for (const cmd of pending) this.send(client, cmd);
  }

  private send(client: DeviceClient, cmd: DeviceCommand) {
    this.sendJson(client, 'command', cmd);
  }

  private sendJson(client: DeviceClient, name: string, body: unknown) {
    client.publish({ cmd: 'publish', qos: 1, dup: false, retain: false, topic: topics.down(client.topicId!, name), payload: Buffer.from(JSON.stringify(body)) } as any, () => {});
  }

  async onModuleDestroy() {
    await this.close();
  }

  async close() {
    for (const s of this.servers) s.close();
    this.servers = [];
    this.clients.clear();
    const broker = this.broker;
    this.broker = null;
    if (broker) await new Promise<void>((resolve) => broker.close(() => resolve()));
  }
}
