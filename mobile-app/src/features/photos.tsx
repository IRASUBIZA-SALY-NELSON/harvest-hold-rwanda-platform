import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { deletePhoto, photoUrl, uploadPhoto, type PhotoKind } from '@/api';
import { useLabels } from '@/lib/hooks';
import { colors, radius, spacing } from '@/theme';
import { confirm, CropMark, Text, useToast } from '@/ui';

/** Longest side sent to the server. Phone cameras take 4000+ px; this keeps uploads around 300 KB on mobile data. */
const MAX_SIDE = 1600;

// ---------- Picking ----------

type Source = 'camera' | 'library';

/** Asks where the photo comes from. Web has no camera choice: the file dialog offers both. */
function chooseSource(t: ReturnType<typeof useLabels>['t']): Promise<Source | null> {
  if (Platform.OS === 'web') return Promise.resolve('library');
  return new Promise((resolve) => {
    Alert.alert(
      t('photos.add'),
      undefined,
      [
        { text: t('photos.take'), onPress: () => resolve('camera') },
        { text: t('photos.choose'), onPress: () => resolve('library') },
        { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(null) },
      ],
      { cancelable: true, onDismiss: () => resolve(null) }
    );
  });
}

/** Opens the camera or gallery and returns a downsized JPEG, or null if cancelled. Throws 'permission' when refused. */
async function pick(source: Source, square: boolean): Promise<string | null> {
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error('permission');
  }
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    quality: 1,
    allowsEditing: square,
    aspect: square ? [1, 1] : undefined,
    exif: false,
  };
  const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];

  const longest = Math.max(asset.width, asset.height);
  const context = ImageManipulator.manipulate(asset.uri);
  if (longest > MAX_SIDE) context.resize(asset.width >= asset.height ? { width: MAX_SIDE } : { height: MAX_SIDE });
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
  return saved.uri;
}

/** Shared by every "add photo" button: asks the source, picks, explains a refused permission. */
export function usePickPhoto() {
  const { t } = useLabels();
  const toast = useToast();
  return useCallback(
    async (options: { square?: boolean } = {}) => {
      const source = await chooseSource(t);
      if (!source) return null;
      try {
        return await pick(source, options.square ?? false);
      } catch (e) {
        toast(t(e instanceof Error && e.message === 'permission' ? 'photos.permissionCamera' : 'errors.unsupportedImage'), 'error');
        return null;
      }
    },
    [t, toast]
  );
}

// ---------- Queue ----------

export interface PhotoItem {
  key: string;
  /** Server id once uploaded. */
  id?: string;
  /** Local file while waiting or uploading. */
  uri?: string;
  state: 'waiting' | 'uploading' | 'done' | 'failed';
  error?: unknown;
}

/**
 * Photos of one listing, batch or profile.
 * Without an `entityId` (the listing or batch does not exist yet) photos wait on the phone and
 * `uploadAll(id)` sends them after it is saved. With one, each photo is uploaded as soon as it is picked.
 */
export function usePhotoQueue(kind: PhotoKind, entityId: string | undefined, existing: string[] = []) {
  const [items, setItems] = useState<PhotoItem[]>([]);
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const counter = useRef(0);

  const patch = (key: string, change: Partial<PhotoItem>) => setItems((list) => list.map((p) => (p.key === key ? { ...p, ...change } : p)));

  const send = useCallback(
    async (item: PhotoItem, target: string | undefined): Promise<boolean> => {
      if (!item.uri) return true;
      patch(item.key, { state: 'uploading', error: undefined });
      try {
        const { id } = await uploadPhoto(kind, item.uri, target);
        patch(item.key, { state: 'done', id });
        return true;
      } catch (error) {
        patch(item.key, { state: 'failed', error });
        return false;
      }
    },
    [kind]
  );

  const add = useCallback(
    (uri: string) => {
      const item: PhotoItem = { key: `local-${++counter.current}`, uri, state: 'waiting' };
      setItems((list) => [...list, item]);
      if (entityId) void send(item, entityId);
    },
    [entityId, send]
  );

  /** Uploads every waiting or failed photo to the entity just created. Returns how many failed. */
  const uploadAll = useCallback(
    async (target: string) => {
      let failed = 0;
      for (const item of items) {
        if (item.state === 'waiting' || item.state === 'failed') {
          if (!(await send(item, target))) failed++;
        }
      }
      return failed;
    },
    [items, send]
  );

  const retry = useCallback((item: PhotoItem) => entityId && send(item, entityId), [entityId, send]);

  const remove = useCallback(async (item: PhotoItem) => {
    if (item.id) {
      await deletePhoto(item.id);
      setRemovedIds((ids) => [...ids, item.id!]);
    }
    setItems((list) => list.filter((p) => p.key !== item.key));
  }, []);

  // Photos already on the server, then this session's additions not yet reflected there.
  const serverItems: PhotoItem[] = existing.filter((id) => !removedIds.includes(id)).map((id) => ({ key: id, id, state: 'done' }));
  const local = items.filter((p) => !(p.id && existing.includes(p.id)));
  const all = [...serverItems, ...local];

  return {
    items: all,
    add,
    remove,
    retry,
    uploadAll,
    busy: items.some((p) => p.state === 'uploading'),
  };
}

// ---------- Editing ----------

/**
 * Row of photo tiles with an "add" tile. Shows upload progress on each tile; a failed one can be
 * retried with a tap. Long-press or the ✕ removes.
 */
export function PhotoEditor({
  queue,
  max,
  hint,
  testID,
}: {
  queue: ReturnType<typeof usePhotoQueue>;
  max: number;
  hint?: string;
  testID?: string;
}) {
  const { t, errorMessage } = useLabels();
  const toast = useToast();
  const pickPhoto = usePickPhoto();
  const [viewing, setViewing] = useState<number | null>(null);
  const full = queue.items.length >= max;

  const addOne = async () => {
    const uri = await pickPhoto();
    if (uri) queue.add(uri);
  };

  const removeOne = async (item: PhotoItem) => {
    const ok = await confirm({
      title: t('photos.removeConfirm'),
      confirmLabel: t('photos.remove'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await queue.remove(item);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const viewable = queue.items.filter((p) => p.state === 'done' && p.id).map((p) => p.id!);

  return (
    <View style={{ gap: spacing.sm }} testID={testID}>
      <View style={styles.editorHead}>
        <Text variant="smallMedium">{t('photos.title')}</Text>
        <Text variant="small" tone="faint">
          {t('photos.count', { n: queue.items.length, max })}
        </Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tiles}>
        {queue.items.map((item, i) => {
          const source = item.id && item.state === 'done' ? photoUrl(item.id, 'thumb') : item.uri;
          return (
            <Pressable
              key={item.key}
              onPress={() => {
                if (item.state === 'failed') void queue.retry(item);
                else if (item.id) setViewing(viewable.indexOf(item.id));
              }}
              onLongPress={() => removeOne(item)}
              accessibilityRole="imagebutton"
              accessibilityLabel={t('photos.photoN', { n: i + 1 })}
              style={styles.tile}
            >
              <Image source={source} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
              {i === 0 && (
                <View style={styles.coverTag}>
                  <Text variant="caption" style={{ color: colors.white }}>
                    {t('photos.cover')}
                  </Text>
                </View>
              )}
              {(item.state === 'uploading' || item.state === 'waiting') && (
                <View style={[styles.overlay, item.state === 'waiting' && styles.waiting]}>
                  {item.state === 'uploading' ? <ActivityIndicator color={colors.white} /> : <Feather name="clock" size={16} color={colors.white} />}
                </View>
              )}
              {item.state === 'failed' && (
                <View style={[styles.overlay, styles.failed]}>
                  <Feather name="refresh-cw" size={18} color={colors.white} />
                  <Text variant="caption" style={{ color: colors.white, textAlign: 'center' }}>
                    {t('photos.retry')}
                  </Text>
                </View>
              )}
              {item.state !== 'uploading' && (
                <Pressable onPress={() => removeOne(item)} hitSlop={8} style={styles.removeBtn} accessibilityLabel={t('photos.remove')}>
                  <Feather name="x" size={13} color={colors.white} />
                </Pressable>
              )}
            </Pressable>
          );
        })}
        {!full && (
          <Pressable
            onPress={addOne}
            style={({ pressed }) => [styles.tile, styles.addTile, pressed && { backgroundColor: colors.brandSoft }]}
            accessibilityRole="button"
            accessibilityLabel={t('photos.add')}
            testID={testID ? `${testID}-add` : undefined}
          >
            <Feather name="camera" size={22} color={colors.brand} />
            <Text variant="caption" tone="brand">
              {t('photos.add')}
            </Text>
          </Pressable>
        )}
      </ScrollView>
      {hint && (
        <Text variant="small" tone="muted">
          {hint}
        </Text>
      )}
      <PhotoViewer ids={viewable} index={viewing} onClose={() => setViewing(null)} />
    </View>
  );
}

// ---------- Viewing ----------

/** Full-width swipeable photos with a page counter. Tap opens the full-screen viewer. */
export function PhotoGallery({ ids, height = 240, testID }: { ids: string[]; height?: number; testID?: string }) {
  const { t } = useLabels();
  const [page, setPage] = useState(0);
  const [viewing, setViewing] = useState<number | null>(null);
  const [width, setWidth] = useState(0);
  if (!ids.length) return null;

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (width) setPage(Math.round(e.nativeEvent.contentOffset.x / width));
  };

  return (
    <View style={[styles.gallery, { height }]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} testID={testID}>
      {width > 0 && (
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} onScroll={onScroll} scrollEventThrottle={32}>
          {ids.map((id, i) => (
            <Pressable key={id} onPress={() => setViewing(i)} accessibilityRole="imagebutton" accessibilityLabel={t('photos.photoN', { n: i + 1 })}>
              <Image source={photoUrl(id)} placeholder={photoUrl(id, 'thumb')} style={{ width, height }} contentFit="cover" transition={200} />
            </Pressable>
          ))}
        </ScrollView>
      )}
      {ids.length > 1 && (
        <View style={styles.pager}>
          <Text variant="caption" style={{ color: colors.white }}>
            {page + 1} / {ids.length}
          </Text>
        </View>
      )}
      <PhotoViewer ids={ids} index={viewing} onClose={() => setViewing(null)} />
    </View>
  );
}

/** Read-only row of small photos; tap one to view it full screen. */
export function PhotoStrip({ ids, size = 72 }: { ids: string[]; size?: number }) {
  const { t } = useLabels();
  const [viewing, setViewing] = useState<number | null>(null);
  if (!ids.length) return null;
  return (
    <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
      {ids.map((id, i) => (
        <Pressable key={id} onPress={() => setViewing(i)} accessibilityRole="imagebutton" accessibilityLabel={t('photos.photoN', { n: i + 1 })}>
          <PhotoThumb id={id} size={size} />
        </Pressable>
      ))}
      <PhotoViewer ids={ids} index={viewing} onClose={() => setViewing(null)} />
    </View>
  );
}

/** Full-screen black viewer; swipe between photos. */
export function PhotoViewer({ ids, index, onClose }: { ids: string[]; index: number | null; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { t } = useLabels();
  const [page, setPage] = useState(0);
  const visible = index !== null && ids.length > 0;

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose} onShow={() => setPage(index ?? 0)} statusBarTranslucent>
      <View style={styles.viewer}>
        {visible && (
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            contentOffset={{ x: (index ?? 0) * width, y: 0 }}
            onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}
          >
            {ids.map((id) => (
              <Image key={id} source={photoUrl(id)} placeholder={photoUrl(id, 'thumb')} style={{ width, height }} contentFit="contain" transition={150} />
            ))}
          </ScrollView>
        )}
        <View style={[styles.viewerBar, { top: insets.top + spacing.sm }]}>
          <Text variant="smallMedium" style={{ color: colors.white }}>
            {ids.length > 1 ? `${page + 1} / ${ids.length}` : ''}
          </Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('common.close')} style={styles.viewerClose}>
            <Feather name="x" size={22} color={colors.white} />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

/** Small square photo, or nothing when there is none (callers fall back to the crop mark). */
export function PhotoThumb({ id, size, dim }: { id: string; size: number; dim?: boolean }) {
  return (
    <Image
      source={photoUrl(id, 'thumb')}
      style={{ width: size, height: size, borderRadius: radius.md, backgroundColor: colors.surface, opacity: dim ? 0.5 : 1 }}
      contentFit="cover"
      transition={150}
      accessibilityIgnoresInvertColors
    />
  );
}

/** The cover photo when there is one, otherwise the crop's letter mark. */
export function CropPhoto({ photoId, label, size = 44, muted }: { photoId?: string; label: string; size?: number; muted?: boolean }) {
  return photoId ? <PhotoThumb id={photoId} size={size} dim={muted} /> : <CropMark label={label} size={size} muted={muted} />;
}

/** Round profile photo, or initials. */
export function Avatar({ name, photoId, size = 40 }: { name: string; photoId?: string | null; size?: number }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      {photoId ? (
        <Image source={photoUrl(photoId, 'thumb')} style={{ width: size, height: size }} contentFit="cover" transition={150} />
      ) : (
        <Text variant={size >= 56 ? 'title' : 'smallMedium'} tone="brand">
          {initials}
        </Text>
      )}
    </View>
  );
}

const TILE = 92;

const styles = StyleSheet.create({
  editorHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tiles: { gap: spacing.sm, paddingVertical: 2 },
  tile: { width: TILE, height: TILE, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surface },
  addTile: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  coverTag: { position: 'absolute', left: 6, bottom: 6, backgroundColor: 'rgba(17,26,20,0.65)', borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 2 },
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', gap: 2, backgroundColor: 'rgba(17,26,20,0.45)' },
  waiting: { backgroundColor: 'rgba(17,26,20,0.25)' },
  failed: { backgroundColor: 'rgba(180,35,24,0.7)', padding: 4 },
  removeBtn: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(17,26,20,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gallery: { borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.surface },
  pager: { position: 'absolute', right: 10, bottom: 10, backgroundColor: 'rgba(17,26,20,0.6)', borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  viewer: { flex: 1, backgroundColor: '#000' },
  viewerBar: { position: 'absolute', left: spacing.lg, right: spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  viewerClose: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  avatar: { backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
