import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useIsFocused, useNavigation } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { useT } from '@/i18n';
import { listeningPreferences, listeningReport, type ListeningRankSort } from '@/lib/listeningDb';
import type { ListeningContentKind } from '@/lib/contentKind';
import { listeningRange, localDay, type ListeningPeriod } from '@/lib/listeningMath';
import { captureLyricOwner } from '@/lib/lyricOwner';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { useListeningStats } from '@/store/listeningStats';
import { useToast } from '@/store/toast';

function listeningVisit(visible: boolean, owns: () => boolean, epoch: number, navigation: object) {
  let active = visible;
  return { visible, owns, epoch, navigation, current: () => active, invalidate: () => { active = false; } };
}
type ListeningReportData = {
  report: Awaited<ReturnType<typeof listeningReport>>;
  preferences: Awaited<ReturnType<typeof listeningPreferences>>;
  owns: () => boolean;
};

/** A local report belongs to the visible profile and one concrete calendar window. */
export function useListeningReport() {
  const t = useT(), focused = useIsFocused(), navigation = useNavigation(), client = useQueryClient();
  const auth = useAuthStore((state) => state.auth);
  const offlineSource = useAuthStore((state) => state.offlineSource);
  const offline = useAuthStore((state) => state.offline);
  const automaticOffline = useAuthStore((state) => state.autoOffline);
  const profile = profileScopeId();
  const prefs = useListeningStats();
  const toast = useToast((state) => state.show);
  const [period, setPeriod] = useState<ListeningPeriod>('month');
  const [kind, setKind] = useState<ListeningContentKind>('music');
  const [sort, setSort] = useState<ListeningRankSort>('seconds');
  const [selectedYear, setSelectedYear] = useState<{ profile: string; year: number }>();
  const [at, setAt] = useState(() => Date.now());
  const [appActive, setAppActive] = useState(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  const [accountEpoch, setAccountEpoch] = useState(0);
  const [visitEpoch, setVisitEpoch] = useState(0);
  const mounted = useRef(true);
  const liveVisit = useRef<ReturnType<typeof listeningVisit> | undefined>(undefined);
  const lastFocus = useRef(focused), lastActive = useRef(appActive);
  const invalidateVisit = useCallback(() => {
    liveVisit.current?.invalidate();
    // A canceled visit must not monopolize the same calendar query after return.
    // Cancellation is scoped to reports, never recording writes or playback.
    void client.cancelQueries({ queryKey: ['listening-stats', profile] });
  }, [client, profile]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => useAuthStore.subscribe((next, before) => {
    if (next.auth !== before.auth || next.offlineSource !== before.offlineSource
      || next.offline !== before.offline || next.autoOffline !== before.autoOffline) {
      // Count the handoff itself, including A -> B -> A in one React batch.
      setAccountEpoch((value) => value + 1);
    }
  }), []);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      const active = state === 'active';
      if (!active) invalidateVisit();
      if (lastActive.current !== active) {
        lastActive.current = active;
        setVisitEpoch((value) => value + 1);
      }
      setAppActive(active);
    });
    return () => subscription.remove();
  }, [invalidateVisit]);
  useEffect(() => {
    const change = (focusedNow: boolean) => {
      if (!focusedNow) invalidateVisit();
      if (lastFocus.current !== focusedNow) {
        lastFocus.current = focusedNow;
        setVisitEpoch((value) => value + 1);
      }
    };
    const blur = navigation.addListener('blur', () => change(false));
    const focus = navigation.addListener('focus', () => change(true));
    return () => { blur(); focus(); };
  }, [navigation, invalidateVisit]);

  const owns = useMemo(() => captureLyricOwner(profile),
    // These values also restart a local-profile visit whose storage scope stays "local".
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profile, auth, offlineSource, offline, automaticOffline, accountEpoch]);
  const visible = focused && appActive;
  const visit = useMemo(() => listeningVisit(visible, owns, visitEpoch, navigation), [visible, owns, visitEpoch, navigation]);
  useEffect(() => {
    liveVisit.current = visit;
    return () => {
      visit.invalidate();
      if (liveVisit.current === visit) liveVisit.current = undefined;
    };
  }, [visit]);
  const [readyVisit, setReadyVisit] = useState<object>();
  const ready = visible && readyVisit === visit && visit.current();
  useEffect(() => {
    if (!visible) return;
    let active = true;
    // Resolve the calendar before enabling this visit. A cached report from
    // yesterday never flashes while the foreground clock catches up.
    void Promise.resolve().then(() => {
      if (!active || !visit.current() || !owns() || !navigation.isFocused()) return;
      setAt(Date.now());
      setReadyVisit(visit);
    });
    return () => { active = false; };
  }, [visible, owns, visit, navigation]);
  const canAct = useCallback(() => mounted.current && visit.current() && readyVisit === visit && navigation.isFocused()
    && AppState.currentState !== 'background' && AppState.currentState !== 'inactive' && owns(),
  [readyVisit, visit, navigation, owns]);
  const currentYear = new Date(at).getFullYear();
  const year = selectedYear?.profile === profile ? selectedYear.year : currentYear;
  const setYear = useCallback((value: number) => {
    if (canAct() && Number.isInteger(value) && value >= 1970 && value <= new Date().getFullYear()) setSelectedYear({ profile, year: value });
  }, [canAct, profile]);
  const range = listeningRange(period, year, at);
  const reportScope = ['listening-stats', profile, accountEpoch, kind, period, range.from, range.until] as const;
  const query = useQuery<ListeningReportData>({
    queryKey: [...reportScope, sort],
    enabled: ready,
    // Sorting changes order, not the report window or its totals. Keeping the
    // same owner's existing report avoids unmounting the calendar/rankings and
    // shortening a scrolled native view while the new SQL ranking is pending.
    placeholderData: (previous, previousQuery) => {
      const key = previousQuery?.queryKey;
      return previous?.owns === owns && owns() && key?.length === reportScope.length + 1
        && reportScope.every((part, index) => key[index] === part) && key[reportScope.length] !== sort ? previous : undefined;
    },
    queryFn: async ({ signal }) => {
      const current = () => canAct() && !signal.aborted;
      if (!current()) throw new Error('Listening report owner changed');
      const report = await listeningReport(profile, range.from, range.until, kind, sort, current);
      if (!current()) throw new Error('Listening report owner changed');
      const preferences = await listeningPreferences(profile);
      if (!current()) throw new Error('Listening report owner changed');
      return { report, preferences, owns };
    },
  });

  useEffect(() => {
    void useListeningStats.getState().load(true).catch(() => {});
  }, [owns]);
  const { refetch } = query;
  useEffect(() => {
    if (ready) void refetch({ cancelRefetch: false });
  }, [ready, owns, refetch]);
  const day = localDay(at);
  useEffect(() => {
    if (!ready) return;
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
    const timer = setTimeout(() => setAt(Date.now()), Math.max(50, midnight - now.getTime() + 50));
    return () => clearTimeout(timer);
  }, [ready, day]);

  // Readiness gates new work/actions, not the frozen same-owner presentation.
  // On foreground the old calendar remains labelled with its old `at` until
  // the clock resolves; a midnight range change then selects another key, so
  // yesterday's values are never presented as today's report.
  const result = query.data?.owns === owns && owns() ? query.data : undefined;
  const matchingPrefs = prefs.profile === profile && prefs.hydrated;
  const startedAt = result?.preferences.startedAt ?? (matchingPrefs && !prefs.error ? prefs.startedAt : undefined);
  const firstYear = startedAt && Number.isFinite(startedAt) ? new Date(startedAt).getFullYear() : currentYear;
  const recordedYear = Number(result?.report.firstRecordedDay?.slice(0, 4));
  const earliestYear = Math.min(currentYear,
    firstYear >= 1970 && firstYear <= currentYear ? firstYear : currentYear,
    Number.isInteger(recordedYear) && recordedYear >= 1970 && recordedYear <= currentYear ? recordedYear : currentYear);
  const years = Array.from({ length: currentYear - earliestYear + 1 }, (_, index) => ({ value: currentYear - index, label: String(currentYear - index) }));

  const busy = useRef<{ token: object; owner: typeof owns } | undefined>(undefined);
  const [busyOwner, setBusyOwner] = useState<typeof owns>();
  const recordingDisabled = !matchingPrefs || busyOwner === owns || !ready;
  const toggleRecording = useCallback((enabled: boolean) => {
    const state = useListeningStats.getState();
    if (!canAct() || !state.hydrated || state.profile !== profile || busy.current?.owner === owns) return;
    const token = {};
    busy.current = { token, owner: owns };
    setBusyOwner(() => owns);
    void (async () => {
      try { await state.setEnabled(enabled); }
      catch { if (canAct()) toast(t('Listening statistics are unavailable')); }
      finally {
        if (busy.current?.token === token) {
          busy.current = undefined;
          if (mounted.current) setBusyOwner(undefined);
        }
      }
    })();
  }, [canAct, owns, profile, t, toast]);
  const refresh = useCallback(() => {
    if (!canAct()) return;
    if (useListeningStats.getState().error) void useListeningStats.getState().load(true).catch(() => {});
    const now = Date.now();
    if (localDay(at) !== localDay(now)) { setAt(now); return; }
    void refetch({ cancelRefetch: false });
  }, [canAct, at, refetch]);

  return {
    profile, period, setPeriod, kind, setKind, year, setYear, sort, setSort, at, range,
    report: result?.report, startedAt, years,
    initialLoading: !result && !query.isError,
    refreshing: query.isFetching || visible && !ready,
    error: query.isError || matchingPrefs && !!prefs.error,
    refresh, recordingEnabled: matchingPrefs && prefs.enabled, recordingDisabled, toggleRecording, canAct,
  };
}
