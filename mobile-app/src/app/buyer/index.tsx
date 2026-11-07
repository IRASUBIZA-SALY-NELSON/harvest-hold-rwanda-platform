import Feather from '@expo/vector-icons/Feather';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { browseListings, type CropId } from '@/api';
import { CROPS, DISTRICTS } from '@/api/constants';
import { BrowseCard } from '@/features/market-rows';
import { useLabels } from '@/lib/hooks';
import { useUser } from '@/state/auth';
import { useApi } from '@/state/use-api';
import { colors, fonts, radius, spacing } from '@/theme';
import { Chip, EmptyState, ErrorState, Loading, PickerSheet, Screen, Text } from '@/ui';

export default function Browse() {
  const user = useUser();
  const { t, lang, crop } = useLabels();
  const [query, setQuery] = useState('');
  const [cropFilter, setCropFilter] = useState<CropId | null>(null);
  const [district, setDistrict] = useState<string | null>(null);
  const [pickDistrict, setPickDistrict] = useState(false);

  const listings = useApi(
    () => browseListings({ query, crop: cropFilter, district, cropLabel: crop }),
    [query, cropFilter, district, lang]
  );
  const filtered = !!(query || cropFilter || district);
  const clear = () => {
    setQuery('');
    setCropFilter(null);
    setDistrict(null);
  };

  return (
    <Screen
      inTabs
      title={t('browse.title')}
      subtitle={user.businessName}
      refreshing={listings.refreshing}
      onRefresh={listings.refresh}
    >
      <View style={styles.search}>
        <Feather name="search" size={18} color={colors.textFaint} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('browse.search')}
          placeholderTextColor={colors.textFaint}
          style={styles.searchInput}
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel={t('browse.search')}
          testID="search"
        />
        {!!query && (
          <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('browse.clear')}>
            <Feather name="x-circle" size={18} color={colors.textFaint} />
          </Pressable>
        )}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={styles.chipScroller}>
        <Chip
          icon="map-pin"
          label={district ?? t('browse.allDistricts')}
          active={!!district}
          onPress={() => setPickDistrict(true)}
        />
        <View style={styles.chipDivider} />
        <Chip label={t('browse.allCrops')} active={!cropFilter} onPress={() => setCropFilter(null)} />
        {CROPS.map((c) => (
          <Chip key={c} label={crop(c)} active={cropFilter === c} onPress={() => setCropFilter(cropFilter === c ? null : c)} />
        ))}
      </ScrollView>

      {listings.loading ? (
        <Loading />
      ) : listings.error ? (
        <ErrorState message={t('common.somethingWrong')} retryLabel={t('common.retry')} onRetry={listings.refresh} />
      ) : !listings.data?.length ? (
        <EmptyState
          icon="search"
          title={t('browse.empty')}
          body={t('browse.emptyBody')}
          action={filtered ? { label: t('browse.clear'), onPress: clear } : undefined}
        />
      ) : (
        <View style={{ gap: spacing.md }}>
          <Text variant="small" tone="muted">
            {t('browse.results', { count: listings.data.length })}
          </Text>
          {listings.data.map((l) => (
            <BrowseCard key={l.id} listing={l} />
          ))}
        </View>
      )}

      <PickerSheet
        visible={pickDistrict}
        title={t('browse.district')}
        value={district ?? '__all'}
        options={[{ value: '__all', label: t('browse.allDistricts') }, ...DISTRICTS.map((d) => ({ value: d, label: d }))]}
        onSelect={(v) => setDistrict(v === '__all' ? null : v)}
        onClose={() => setPickDistrict(false)}
        searchPlaceholder={t('auth.chooseDistrict')}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 48,
    paddingHorizontal: spacing.md + 2,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.text,
    height: '100%',
    outlineStyle: 'none' as never,
  },
  chipScroller: { marginHorizontal: -(spacing.xl - 4), flexGrow: 0 },
  chips: { gap: spacing.sm, paddingHorizontal: spacing.xl - 4, alignItems: 'center' },
  chipDivider: { width: 1, height: 20, backgroundColor: colors.border, marginHorizontal: 2 },
});
