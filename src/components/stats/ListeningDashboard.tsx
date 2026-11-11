import { useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import Icon from '@/components/Icon';
import { SelectList } from '@/components/SettingsUI';
import { SettingAnchor } from '@/components/SettingAnchor';
import { useT } from '@/i18n';
import type { ListeningReport } from '@/lib/listeningDb';
import { listeningBars, listeningInsights, localDay, type ListeningBar, type ListeningPeriod } from '@/lib/listeningMath';
import { calendarMonthShift, listeningCalendarCells, listeningDateLabel, listeningDurationParts, listeningHeatmapTone, validListeningDay } from '@/lib/listeningPresentation';
import { fontSize, themed, useTheme, useThemeMode } from '@/theme';

/** Compact native choices. The label remains a stable settings-search anchor. */
export function ListeningSegments<T extends string>({ label, value, options, onChange, showLabel = false }: {
  label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void; showLabel?: boolean;
}) {
  const theme = useTheme();
  return <SettingAnchor label={label}><View style={{ gap: 8 }}>
    {showLabel ? <Text style={styles.sectionTitle}>{label}</Text> : null}
    <View style={styles.segments} accessibilityLabel={label}>
      {options.map((option) => <Pressable key={option.value} accessibilityRole="button" accessibilityState={{ selected: value === option.value }}
        onPress={() => onChange(option.value)} style={({ pressed }) => [styles.segment, value === option.value && { backgroundColor: theme.surface }, pressed && { opacity: 0.65 }]}>
        <Text style={[styles.segmentText, value === option.value && { color: theme.text, fontWeight: '600' }]}>{option.label}</Text>
      </Pressable>)}
    </View>
  </View></SettingAnchor>;
}

function Metric({ label, value, unit, icon, color, pending }: {
  label: string; value: string; unit?: string; icon: keyof typeof Icon.glyphMap; color: string; pending: boolean;
}) {
  return <View style={styles.metric} accessibilityLabel={`${label}: ${value}${unit ? ` ${unit}` : ''}`}>
    <View pointerEvents="none" style={[styles.metricTint, { backgroundColor: color }]} />
    <View style={styles.metricLabelRow}><Icon name={icon} size={17} color={color} /><Text style={styles.metricLabel}>{label}</Text></View>
    <View style={styles.metricValueRow}><Text style={[styles.metricValue, pending && styles.pendingValue]}>{value}</Text>{unit ? <Text style={styles.metricUnit}>{unit}</Text> : null}</View>
  </View>;
}

function Trend({ data, period, year, at, language }: { data: ListeningReport; period: ListeningPeriod; year: number; at: number; language: string }) {
  const t = useT(), theme = useTheme();
  const [metric, setMetric] = useState<'seconds' | 'plays'>('seconds');
  const bars = useMemo(() => listeningBars(data.days, period, year, at), [data.days, period, year, at]);
  const [selected, setSelected] = useState<string>();
  const [width, setWidth] = useState(1);
  const index = Math.max(0, bars.findIndex((bar) => bar.key === selected));
  const chosen = bars.find((bar) => bar.key === selected);
  const peak = Math.max(1, ...bars.map((bar) => bar[metric]));
  const duration = (seconds: number) => { const p = listeningDurationParts(seconds, language); return `${p.value} ${t(p.unit)}`; };
  const valueText = (bar: ListeningBar) => metric === 'seconds' ? duration(bar.seconds) : t('{n} plays', { n: bar.plays });
  const title = chosen ? listeningDateLabel(chosen.key, language) : t('Tap the chart to see details');
  return <View style={styles.card}>
    <Text accessibilityRole="header" style={styles.sectionTitle}>{t('Listening trend')}</Text>
    <ListeningSegments label={t('Chart metric')} value={metric} onChange={setMetric} options={[{ value: 'seconds', label: t('Listening time') }, { value: 'plays', label: t('Play count') }]} />
    <View style={styles.chartReadout}><Text style={styles.hint}>{title}</Text><Text style={styles.chartValue}>{chosen ? valueText(chosen) : metric === 'seconds' ? duration(data.seconds) : t('{n} plays', { n: data.plays })}</Text></View>
    <Pressable accessibilityRole="adjustable" accessibilityLabel={t('Listening time chart')}
      accessibilityValue={{ min: 0, max: Math.max(0, bars.length - 1), now: index, text: chosen ? `${title}: ${valueText(chosen)}` : title }}
      accessibilityActions={[{ name: 'increment', label: t('Next') }, { name: 'decrement', label: t('Previous') }]}
      onAccessibilityAction={(event) => { const next = Math.min(bars.length - 1, Math.max(0, index + (event.nativeEvent.actionName === 'increment' ? 1 : -1))); if (bars[next]) setSelected(bars[next].key); }}
      onLayout={(event) => setWidth(Math.max(1, event.nativeEvent.layout.width))}
      onPress={(event) => { const next = Math.min(bars.length - 1, Math.max(0, Math.floor(event.nativeEvent.locationX / width * bars.length))); if (bars[next]) setSelected(bars[next].key); }}
      style={styles.chart}>
      <View pointerEvents="none" style={styles.chartGuides}>{[0, 1, 2].map((key) => <View key={key} style={styles.chartGuide} />)}</View>
      {bars.map((bar) => <View pointerEvents="none" key={bar.key} style={styles.chartColumn}>
        <View style={[styles.chartBar, { height: bar[metric] > 0 ? Math.max(4, 112 * bar[metric] / peak) : 2, backgroundColor: theme.accent,
          opacity: chosen && chosen.key !== bar.key ? 0.35 : bar[metric] > 0 ? 1 : 0.18 }]} />
      </View>)}
    </Pressable>
    <View style={styles.axis}>{[0, Math.floor((bars.length - 1) / 2), bars.length - 1].filter((n, i, a) => a.indexOf(n) === i).map((n) => <Text key={n} style={styles.axisText}>{bars[n]?.label}</Text>)}</View>
  </View>;
}

function Calendar({ data, range, at, language }: { data: ListeningReport; range: { from: string; until: string }; at: number; language: string }) {
  const t = useT(), theme = useTheme();
  const recordedDays = useMemo(() => data.days.filter((day) => validListeningDay(day.day)), [data.days]);
  const first = recordedDays.find((day) => (day.seconds > 0 || day.plays > 0))?.day;
  const minimum = (range.from === '1970-01-01' ? first ?? localDay(at) : range.from).slice(0, 7);
  const lastIncluded = new Date(`${range.until}T12:00:00`); lastIncluded.setDate(lastIncluded.getDate() - 1);
  const maximum = (localDay(lastIncluded.getTime()) < localDay(at) ? localDay(lastIncluded.getTime()) : localDay(at)).slice(0, 7);
  const lastRecorded = recordedDays.at(-1)?.day.slice(0, 7) ?? maximum;
  const [chosenMonth, setChosenMonth] = useState('');
  const month = chosenMonth >= minimum && chosenMonth <= maximum ? chosenMonth : lastRecorded >= minimum && lastRecorded <= maximum ? lastRecorded : maximum;
  const [showPicker, setShowPicker] = useState(false);
  const [chosenDay, setChosenDay] = useState<string>();
  const cells = useMemo(() => listeningCalendarCells(month, recordedDays, range.from, range.until < localDay(at) ? range.until : localDay(new Date(new Date(at).getFullYear(), new Date(at).getMonth(), new Date(at).getDate() + 1).getTime())), [month, recordedDays, range.from, range.until, at]);
  const calendarMetric = data.seconds > 0 ? 'seconds' : 'plays';
  const peak = Math.max(1, ...recordedDays.map((day) => day[calendarMetric]));
  const day = cells.find((cell) => cell.key === chosenDay && cell.enabled);
  const monthDate = new Date(`${month}-01T12:00:00`);
  const monthLabel = new Intl.DateTimeFormat(language, { year: 'numeric', month: 'long' }).format(monthDate);
  const weekdays = useMemo(() => { const formatter = new Intl.DateTimeFormat(language, { weekday: 'narrow' }); return Array.from({ length: 7 }, (_, i) => formatter.format(new Date(2024, 0, 1 + i))); }, [language]);
  const years = Array.from({ length: Math.max(1, Number(maximum.slice(0, 4)) - Number(minimum.slice(0, 4)) + 1) }, (_, i) => ({ value: Number(minimum.slice(0, 4)) + i, label: String(Number(minimum.slice(0, 4)) + i) }));
  const changeMonth = (next: string) => setChosenMonth(next < minimum ? minimum : next > maximum ? maximum : next);
  const duration = (seconds: number) => { const p = listeningDurationParts(seconds, language); return `${p.value} ${t(p.unit)}`; };
  return <View style={styles.card}>
    <Text accessibilityRole="header" style={styles.sectionTitle}>{t('Listening calendar')}</Text>
    <View style={styles.calendarToolbar}>
      <Pressable disabled={month <= minimum} accessibilityRole="button" accessibilityLabel={t('Previous month')} onPress={() => changeMonth(calendarMonthShift(month, -1))} style={[styles.monthArrow, month <= minimum && { opacity: 0.3 }]}><Icon name="chevron-back" size={19} color={theme.text} /></Pressable>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: showPicker }} onPress={() => setShowPicker(!showPicker)} style={styles.monthName}><Text style={styles.monthTitle}>{monthLabel}</Text><Icon name={showPicker ? 'chevron-up' : 'chevron-down'} size={14} color={theme.textSecondary} /></Pressable>
      <Pressable disabled={month >= maximum} accessibilityRole="button" accessibilityLabel={t('Next month')} onPress={() => changeMonth(calendarMonthShift(month, 1))} style={[styles.monthArrow, month >= maximum && { opacity: 0.3 }]}><Icon name="chevron-forward" size={19} color={theme.text} /></Pressable>
    </View>
    {showPicker ? <View>
      <SelectList label={t('Calendar year')} value={Number(month.slice(0, 4))} options={years} onChange={(value) => changeMonth(`${value}-${month.slice(5)}`)} />
      <SelectList label={t('Calendar month')} value={month.slice(5)} options={Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1).padStart(2, '0'), label: new Intl.DateTimeFormat(language, { month: 'long' }).format(new Date(2024, i, 1)) })).filter((option) => `${month.slice(0, 4)}-${option.value}` >= minimum && `${month.slice(0, 4)}-${option.value}` <= maximum)} onChange={(value) => changeMonth(`${month.slice(0, 4)}-${value}`)} />
    </View> : null}
    <View style={styles.calendarGrid}>{Array.from({ length: 7 }, (_, i) => <View key={i} style={styles.daySlot}><Text style={styles.weekday}>{weekdays[i]}</Text></View>)}</View>
    <View style={styles.calendarGrid}>{cells.map((cell) => { const tone = cell[calendarMetric] > 0 ? listeningHeatmapTone(theme.accent, theme.surface, cell[calendarMetric] / peak) : undefined; return <Pressable key={cell.key} disabled={!cell.enabled} accessibilityRole="button" accessibilityState={{ selected: day?.key === cell.key, disabled: !cell.enabled }}
      accessibilityLabel={cell.enabled ? t('{date}: {time}, {n} plays', { date: cell.key, time: duration(cell.seconds), n: cell.plays }) : cell.key}
      onPress={() => setChosenDay(cell.key)} style={styles.daySlot}>
      {cell.insideMonth ? <View style={[styles.calendarDay, day?.key === cell.key && { borderColor: theme.text, borderWidth: 1.5 }]}>
        {cell[calendarMetric] > 0 ? <View style={[styles.dayFill, { backgroundColor: tone?.backgroundColor }]} /> : null}
        <Text style={[styles.dayNumber, tone && { color: tone.color }, !cell.enabled && { color: theme.textMuted, opacity: 0.4 }]}>{cell.date}</Text>
      </View> : null}
    </Pressable>; })}</View>
    <View style={styles.calendarDetail}>
      <Text style={styles.hint}>{day ? listeningDateLabel(day.key, language) : t('Tap a day to see listening details')}</Text>
      {day ? <Text style={styles.detailValue}>{(day.seconds > 0 || day.plays > 0) ? `${duration(day.seconds)} · ${t('{n} plays', { n: day.plays })}` : t('No listening recorded')}</Text> : <View style={styles.legend}><Text style={styles.legendText}>{t('Less')}</Text>{[0.18, 0.4, 0.65, 0.9].map((opacity) => <View key={opacity} style={[styles.legendDot, { backgroundColor: theme.accent, opacity }]} />)}<Text style={styles.legendText}>{t('More')}</Text></View>}
    </View>
  </View>;
}

export function ListeningDashboardHeader({ report, period, year, at, range, language, kind, pending, refreshing, error, controls, rankingControls, podium, onRefresh }: {
  report?: ListeningReport; period: ListeningPeriod; year: number; at: number; range: { from: string; until: string }; language: string; kind: string;
  pending: boolean; refreshing: boolean; error: boolean; controls: ReactNode; rankingControls: ReactNode; podium: ReactNode; onRefresh: () => void;
}) {
  const theme = useTheme(), dark = useThemeMode() === 'dark', t = useT();
  const number = (value: number) => new Intl.NumberFormat(language, { notation: value >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value);
  const duration = report ? listeningDurationParts(report.seconds, language) : undefined;
  const insights = useMemo(() => report ? listeningInsights(report.days, range.from, range.until) : undefined, [report, range.from, range.until]);
  const end = new Date(`${range.until}T12:00:00`); end.setDate(end.getDate() - 1);
  const dateRange = period === 'all' ? t('All recorded listening') : `${listeningDateLabel(range.from, language)} – ${listeningDateLabel(localDay(end.getTime()), language)}`;
  const loading = pending || !report;
  return <View style={styles.headerStack}>
    <View style={styles.hero}>
      <View style={styles.heroTop}><View style={styles.localBadge}><Icon name="phone-portrait-outline" size={13} color={theme.textSecondary} /><Text style={styles.badgeText}>{t('On this device')}</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Refresh report')} disabled={refreshing} onPress={onRefresh} style={styles.refresh}>{refreshing ? <ActivityIndicator size="small" color={theme.accent} /> : <Icon name="refresh-outline" size={19} color={theme.accent} />}</Pressable>
      </View>
      <Text accessibilityRole="header" style={styles.heroTitle}>{period === 'year' ? t('Your listening in {year}', { year }) : t('Your listening')}</Text>
      <Text style={styles.heroSubtitle}>{dateRange}</Text>
    </View>
    <View style={styles.controls}>{controls}</View>
    {!report && error ? <View style={styles.card}><Icon name="cloud-offline-outline" size={28} color={theme.textSecondary} /><Text accessibilityRole="alert" style={styles.sectionTitle}>{t('Listening statistics are unavailable')}</Text><Pressable onPress={onRefresh} accessibilityRole="button" style={styles.retry}><Text style={styles.retryText}>{t('Retry')}</Text></Pressable></View> : <>
      <View style={styles.metrics}>
        <Metric label={t('Listening time')} value={duration?.value ?? '—'} unit={duration ? t(duration.unit) : undefined} icon="headset-outline" color={dark ? '#74D4A5' : '#197A4D'} pending={loading} />
        <Metric label={t('Qualified plays')} value={report ? number(report.plays) : '—'} icon="play-circle-outline" color={dark ? '#81B1FF' : '#285FC6'} pending={loading} />
        <Metric label={t('Active days')} value={report ? number(report.activeDays) : '—'} unit={t('Days')} icon="calendar-outline" color={dark ? '#F0B96C' : '#A96713'} pending={loading} />
        <Metric label={t(kind === 'music' ? 'Different songs' : 'Different episodes or chapters')} value={report ? number(report.songs) : '—'} icon={kind === 'music' ? 'musical-notes-outline' : 'book-outline'} color={dark ? '#BC9DFF' : '#8156BD'} pending={loading} />
      </View>
      {loading ? <View style={styles.loading}><ActivityIndicator color={theme.accent} /><Text style={styles.hint}>{t('Loading listening report')}</Text></View> : report && (report.seconds > 0 || report.plays > 0) ? <>
        <Calendar data={report} range={range} at={at} language={language} />
        <Trend data={report} period={period} year={year} at={at} language={language} />
        <View style={styles.insights}>
          <View style={styles.insight}><Text style={styles.hint}>{t('Average per active day')}</Text><Text style={styles.insightValue}>{(() => { const p = listeningDurationParts(insights?.dailyAverageSeconds ?? 0, language); return `${p.value} ${t(p.unit)}`; })()}</Text></View>
          <View style={styles.insight}><Text style={styles.hint}>{t('Longest listening streak')}</Text><Text style={styles.insightValue}>{t('{n} days', { n: insights?.longestStreak ?? 0 })}</Text></View>
        </View>
      </> : <View style={[styles.card, styles.empty]}><Icon name="headset-outline" size={34} color={theme.accent} /><Text style={styles.emptyTitle}>{t('Your next listen starts the story')}</Text><Text style={styles.emptyDescription}>{t('No listening recorded in this period. Try another range or play something to start your report.')}</Text></View>}
    </>}
    {report && (report.seconds > 0 || report.plays > 0) ? <View style={styles.rankingHeader}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>{t('Listening rankings')}</Text>
      {rankingControls}{podium}
    </View> : null}
  </View>;
}

const styles = themed((c) => ({
  headerStack: { gap: 18, paddingTop: 6 },
  hero: { gap: 8, paddingHorizontal: 4 },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  localBadge: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  badgeText: { color: c.textSecondary, fontSize: 12, lineHeight: 18 },
  heroTitle: { color: c.text, fontSize: 29, lineHeight: 37, fontWeight: '700', letterSpacing: -0.6 },
  heroSubtitle: { color: c.textSecondary, fontSize: 14, lineHeight: 21 },
  refresh: { width: 44, height: 36, alignItems: 'center', justifyContent: 'center' },
  controls: { gap: 9 },
  segments: { flexDirection: 'row', padding: 3, gap: 2, borderRadius: 13, backgroundColor: c.surfaceHighlight },
  segment: { flex: 1, minWidth: 0, minHeight: 38, borderRadius: 10, paddingHorizontal: 5, paddingVertical: 8, alignItems: 'center', justifyContent: 'center' },
  segmentText: { color: c.textSecondary, fontSize: 13, lineHeight: 18, textAlign: 'center' },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metric: { width: '48%', flexGrow: 1, borderRadius: 18, padding: 15, minHeight: 108, backgroundColor: c.surface, overflow: 'hidden', gap: 14 },
  metricTint: { position: 'absolute', top: 0, right: 0, left: 0, bottom: 0, opacity: 0.055 },
  metricLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  metricLabel: { color: c.textSecondary, fontSize: 13, lineHeight: 19, flex: 1 },
  metricValueRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: 5 },
  metricValue: { color: c.text, fontSize: 29, lineHeight: 36, fontWeight: '600', fontVariant: ['tabular-nums'] },
  metricUnit: { color: c.textSecondary, fontSize: 12, lineHeight: 19 },
  pendingValue: { color: c.textMuted },
  card: { backgroundColor: c.surface, borderRadius: 20, padding: 16, gap: 14 },
  sectionTitle: { color: c.text, fontSize: fontSize.md, lineHeight: 23, fontWeight: '600' },
  hint: { color: c.textSecondary, fontSize: 12, lineHeight: 19 },
  chartReadout: { gap: 4, minHeight: 52 },
  chartValue: { color: c.text, fontSize: 21, lineHeight: 28, fontWeight: '600', fontVariant: ['tabular-nums'] },
  chart: { height: 124, flexDirection: 'row', alignItems: 'flex-end', gap: 4, paddingTop: 8 },
  chartGuides: { position: 'absolute', top: 12, right: 0, left: 0, bottom: 0, justifyContent: 'space-between' },
  chartGuide: { height: 1, backgroundColor: c.border },
  chartColumn: { flex: 1, height: '100%', justifyContent: 'flex-end', alignItems: 'center' },
  chartBar: { width: '86%', minWidth: 2, maxWidth: 26, borderRadius: 4 },
  axis: { flexDirection: 'row', justifyContent: 'space-between' },
  axisText: { color: c.textSecondary, fontSize: 10, lineHeight: 16 },
  calendarToolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  monthArrow: { minWidth: 42, minHeight: 42, alignItems: 'center', justifyContent: 'center' },
  monthName: { flex: 1, minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  monthTitle: { color: c.text, fontSize: 14, lineHeight: 22, fontWeight: '600' },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  daySlot: { width: '14.2857%', minHeight: 42, alignItems: 'center', justifyContent: 'center' },
  weekday: { color: c.textSecondary, fontSize: 11, lineHeight: 18 },
  calendarDay: { width: 33, height: 33, borderRadius: 9, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  dayFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  dayNumber: { color: c.text, fontSize: 12, lineHeight: 18, fontWeight: '500' },
  calendarDetail: { minHeight: 54, justifyContent: 'center', gap: 6, paddingTop: 10, borderTopWidth: 0.5, borderTopColor: c.border },
  detailValue: { color: c.text, fontSize: 13, lineHeight: 20, fontWeight: '500' },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendText: { color: c.textSecondary, fontSize: 10, lineHeight: 16 },
  legendDot: { width: 10, height: 10, borderRadius: 3 },
  insights: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  insight: { flexBasis: 130, flexGrow: 1, gap: 6, padding: 15, backgroundColor: c.surface, borderRadius: 18 },
  insightValue: { color: c.text, fontSize: 17, lineHeight: 25, fontWeight: '600' },
  loading: { flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'center', minHeight: 110 },
  empty: { alignItems: 'center', paddingVertical: 30 },
  emptyTitle: { color: c.text, fontSize: 18, lineHeight: 25, fontWeight: '600', textAlign: 'center' },
  emptyDescription: { color: c.textSecondary, fontSize: 14, lineHeight: 22, textAlign: 'center' },
  rankingHeader: { gap: 12, paddingTop: 5 },
  retry: { alignSelf: 'flex-start', paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, backgroundColor: c.surfaceHighlight },
  retryText: { color: c.accent, fontSize: 14, fontWeight: '600' },
}));
