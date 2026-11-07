/** Short texts for push notifications and SMS, in the user's language. In-app text comes from the app's own translations. */

export type Lang = 'rw' | 'en' | 'fr';

const crops: Record<Lang, Record<string, string>> = {
  en: { tomato: 'Tomatoes', carrot: 'Carrots', cabbage: 'Cabbage', greenBeans: 'Green beans', avocado: 'Avocados', passionFruit: 'Passion fruit', pepper: 'Peppers', spinach: 'Spinach', eggplant: 'Eggplant', mango: 'Mangoes' },
  rw: { tomato: 'Inyanya', carrot: 'Karoti', cabbage: 'Amashu', greenBeans: 'Imiteja', avocado: 'Avoka', passionFruit: 'Marakuja', pepper: 'Puwavuro', spinach: 'Epinari', eggplant: 'Intoryi', mango: 'Imyembe' },
  fr: { tomato: 'Tomates', carrot: 'Carottes', cabbage: 'Chou', greenBeans: 'Haricots verts', avocado: 'Avocats', passionFruit: 'Fruits de la passion', pepper: 'Poivrons', spinach: 'Épinards', eggplant: 'Aubergines', mango: 'Mangues' },
};

const templates: Record<Lang, Record<string, string>> = {
  en: {
    chamberWarm: '{room} is too warm: {temp}°C (limit {max}°C).',
    chamberCold: '{room} is too cold: {temp}°C. Crops may freeze.',
    humidityLow: '{room} air is too dry ({humidity}%). Crops may wilt.',
    backToNormal: '{room} is back in the safe range.',
    batteryLow: '{room} battery is low ({battery}%).',
    iceLow: '{room} ice bank is running low.',
    coolerOverheat: '{room} cooler hot side is too hot ({temp}°C). Power is reduced. Check the hot-side fan and heatsink.',
    certificateRevoked: 'Certificate {id} was revoked by Harvest Hold: {reason}',
    coolerFault: '{room} cooler is not working. Check its fuse, wiring and module.',
    coolingCapacity: '{room} cooler is at full power and cannot reach the target. Check the door seal and the load.',
    offline: '{room} stopped sending data.',
    storageAccepted: 'Your {crop} is stored: {quantity} {unit} confirmed (batch {code}).',
    storageDeclined: 'Your storage request for {crop} was declined: {reason}',
    orderNew: '{buyer} ordered {quantity} {unit} of {crop}.',
    orderAccepted: '{farmer} accepted your order of {crop}.',
    orderDeclined: '{farmer} declined your order of {crop}.',
    orderCancelled: '{buyer} cancelled their order of {crop}.',
  },
  rw: {
    chamberWarm: '{room} irashyushye cyane: {temp}°C (ntibigomba kurenza {max}°C).',
    chamberCold: '{room} irakonje cyane: {temp}°C. Imyaka ishobora gukonja ikangirika.',
    humidityLow: 'Umwuka wo muri {room} wumye cyane ({humidity}%). Imyaka ishobora kuraba.',
    backToNormal: '{room} yasubiye ku bukonje bukwiye.',
    batteryLow: 'Batiri ya {room} iri hasi ({battery}%).',
    iceLow: 'Urubura rwo muri {room} ruri gushira.',
    coolerOverheat: 'Uruhande rushyushye rwa cooler ya {room} rurashyushye cyane ({temp}°C). Ingufu zagabanyijwe. Genzura fani n’icyuma gikurura ubushyuhe.',
    certificateRevoked: 'Icyemezo {id} cyakuweho na Harvest Hold: {reason}',
    coolerFault: 'Cooler ya {room} ntikora. Genzura fuse, insinga na module.',
    coolingCapacity: 'Cooler ya {room} irakora ku ngufu zose ariko ntigera ku bukonje bukenewe. Genzura umuryango n’ibyo washyizemo.',
    offline: '{room} yahagaritse kohereza amakuru.',
    storageAccepted: '{crop} yawe yabitswe: {quantity} {unit} byemejwe (kode {code}).',
    storageDeclined: 'Icyifuzo cyawe cyo kubika {crop} cyanzwe: {reason}',
    orderNew: '{buyer} yatumije {quantity} {unit} bya {crop}.',
    orderAccepted: '{farmer} yemeye ibyo watumije bya {crop}.',
    orderDeclined: '{farmer} yanze ibyo watumije bya {crop}.',
    orderCancelled: '{buyer} yahagaritse ibyo yatumije bya {crop}.',
  },
  fr: {
    chamberWarm: '{room} est trop chaude : {temp} °C (limite {max} °C).',
    chamberCold: '{room} est trop froide : {temp} °C. Les produits risquent de geler.',
    humidityLow: 'L’air de {room} est trop sec ({humidity} %). Les produits risquent de se flétrir.',
    backToNormal: '{room} est revenue dans la plage sûre.',
    batteryLow: 'La batterie de {room} est faible ({battery} %).',
    iceLow: 'La réserve de glace de {room} s’épuise.',
    coolerOverheat: 'Le côté chaud du refroidisseur de {room} est trop chaud ({temp} °C). Puissance réduite. Vérifiez le ventilateur et le dissipateur.',
    certificateRevoked: 'Le certificat {id} a été révoqué par Harvest Hold : {reason}',
    coolerFault: 'Le refroidisseur de {room} ne fonctionne pas. Vérifiez le fusible, le câblage et le module.',
    coolingCapacity: 'Le refroidisseur de {room} est à pleine puissance sans atteindre la consigne. Vérifiez le joint de porte et la charge.',
    offline: '{room} n’envoie plus de données.',
    storageAccepted: 'Votre {crop} est stocké : {quantity} {unit} confirmés (lot {code}).',
    storageDeclined: 'Votre demande de stockage de {crop} a été refusée : {reason}',
    orderNew: '{buyer} a commandé {quantity} {unit} de {crop}.',
    orderAccepted: '{farmer} a accepté votre commande de {crop}.',
    orderDeclined: '{farmer} a refusé votre commande de {crop}.',
    orderCancelled: '{buyer} a annulé sa commande de {crop}.',
  },
};

export function message(lang: Lang, type: string, params: Record<string, string | number>): string {
  const template = templates[lang]?.[type] ?? templates.en[type] ?? type;
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const v = params[key];
    if (key === 'crop' && typeof v === 'string') return crops[lang][v] ?? v;
    return v === undefined ? '' : String(v);
  });
}
