import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  api,
  type Account,
  type SplitwiseImportInput,
  type SplitwiseImportResult,
  type SplitwisePreview,
  type SplitwiseSkipped,
} from '../../api';
import type { Catalog } from '../../utils';
import { fmt, fmtDate, shortName } from '../../utils';
import { pickCsvText } from '../../splitwiseFile';
import { toReviewRows, type ReviewRow } from '../../splitwiseReview';
import { CloseIcon } from '../icons';
import { Overlay } from '../Overlay';
import { Select } from '../Select';

const MEMBER_KEY = 'splitwise.memberName';
const LOW_CONFIDENCE = 0.5;

type Step = 'pick' | 'member' | 'review' | 'done';

interface ImportSplitwiseModalProps {
  accounts: Account[];
  catalog: Catalog;
  onClose: () => void;
  onImport: (input: SplitwiseImportInput) => Promise<SplitwiseImportResult>;
}

export function ImportSplitwiseModal({ accounts, catalog, onClose, onImport }: ImportSplitwiseModalProps) {
  const banks = accounts.filter(a => a.kind === 'bank');
  const cards = accounts.filter(a => a.kind === 'credit_card');
  const defaultAccount = accounts.find(a => a.role === 'primary') ?? accounts[0];

  const [step, setStep] = useState<Step>('pick');
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [members, setMembers] = useState<string[]>([]);
  const [memberName, setMemberName] = useState<string | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [alreadyCount, setAlreadyCount] = useState(0);
  const [skipped, setSkipped] = useState<SplitwiseSkipped[]>([]);
  const [showSkipped, setShowSkipped] = useState(false);
  const [settlements, setSettlements] = useState<SplitwisePreview['settlements']>([]);
  const [classifier, setClassifier] = useState<'ok' | 'unavailable' | 'not_run'>('not_run');
  const [accountId, setAccountId] = useState(defaultAccount?.id ?? '');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<SplitwiseImportResult | null>(null);

  // Wakes the Hugging Face Space while the user is still finding the file,
  // so the categorizer is more likely to be up by the time preview runs.
  useEffect(() => {
    api.splitwiseClassifierStatus().catch(() => {});
  }, []);

  async function runPreview(text: string, member: string | null) {
    setBusy('Reading and categorizing… the first run of the day can take a minute');
    setError('');
    try {
      const preview = await api.splitwisePreview({ csv: text, memberName: member });
      setMembers(preview.members);
      if (!preview.memberName) {
        // No preselection: picking someone else records their shares, and
        // imported rows can't be undone.
        setMemberName(null);
        setStep('member');
        return;
      }
      setMemberName(preview.memberName);
      await AsyncStorage.setItem(MEMBER_KEY, preview.memberName);
      // Retry and a member change keep the user's own picks and unticks.
      setRows(current => toReviewRows(preview.rows, current));
      setAlreadyCount(preview.rows.filter(r => r.alreadyImported).length);
      setSkipped(preview.skipped);
      setSettlements(preview.settlements);
      setClassifier(preview.classifier);
      setStep('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the file');
    } finally {
      setBusy('');
    }
  }

  async function pickFile() {
    setError('');
    try {
      const picked = await pickCsvText();
      if (!picked) return;
      setCsv(picked.text);
      setFileName(picked.name);
      await runPreview(picked.text, await AsyncStorage.getItem(MEMBER_KEY));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the file');
    }
  }

  function update(fingerprint: string, patch: Partial<ReviewRow>) {
    setRows(current => current.map(r => (r.fingerprint === fingerprint ? { ...r, ...patch } : r)));
  }

  const included = rows.filter(r => r.include);
  const missing = included.filter(r => !r.chosen).length;
  const total = included.reduce((sum, r) => sum + r.amount, 0);

  async function submit() {
    if (included.length === 0) {
      setError('Tick at least one expense to import');
      return;
    }
    if (missing > 0) {
      setError(`Pick a category for ${missing} expense${missing === 1 ? '' : 's'}`);
      return;
    }
    setBusy('Importing…');
    setError('');
    try {
      const res = await onImport({
        accountId,
        rows: included.map(r => ({
          fingerprint: r.fingerprint,
          date: r.date,
          description: r.description,
          amount: r.amount,
          category: r.chosen as string,
        })),
      });
      setResult(res);
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not import the expenses');
    } finally {
      setBusy('');
    }
  }

  const categoryOptions = catalog.spendable.map(c => ({ label: c.name, value: c.name }));

  return (
    <Overlay onClose={onClose} wide={step === 'review'}>
      <View className="gap-5">
        <View className="flex-row items-center justify-between">
          <Text className="text-lg font-semibold text-ink">Import from Splitwise</Text>
          <Pressable onPress={onClose} className="h-8 w-8 items-center justify-center rounded-full">
            <CloseIcon />
          </Pressable>
        </View>

        {step === 'pick' && (
          <View className="gap-3">
            <Text className="text-sm text-ink-secondary">
              In Splitwise, open a group or friend and choose Export as spreadsheet. Pick that CSV here. Your share of each
              expense is recorded on the date it happened, and categories are suggested for you to review.
            </Text>
            <Pressable onPress={pickFile} disabled={!!busy} className="rounded-xl bg-accent py-3" style={{ opacity: busy ? 0.5 : 1 }}>
              <Text className="text-center text-sm font-semibold text-white">{busy ? 'Working…' : 'Choose CSV file'}</Text>
            </Pressable>
          </View>
        )}

        {step === 'member' && (
          <View className="gap-3">
            <Text className="text-sm text-ink-secondary">Which person in {fileName || 'this export'} is you?</Text>
            <Select
              value={memberName ?? ''}
              onChange={value => setMemberName(value || null)}
              options={[...(memberName ? [] : [{ label: 'Choose your name', value: '' }]), ...members.map(m => ({ label: m, value: m }))]}
            />
            <Pressable
              onPress={() => runPreview(csv, memberName)}
              disabled={!memberName || !!busy}
              className="rounded-xl bg-accent py-3"
              style={{ opacity: !memberName || busy ? 0.5 : 1 }}
            >
              <Text className="text-center text-sm font-semibold text-white">{busy ? 'Working…' : 'Continue'}</Text>
            </Pressable>
          </View>
        )}

        {step === 'review' && (
          <View className="gap-4">
            {classifier === 'unavailable' && (
              <View className="flex-row items-center justify-between gap-3 rounded-xl border border-[#ff9f0a]/40 bg-[#ff9f0a]/[0.08] px-4 py-3">
                <Text className="flex-1 text-xs text-ink-secondary">
                  The categorizer didn't respond. Pick categories yourself, or try again in a minute.
                </Text>
                <Pressable onPress={() => runPreview(csv, memberName)} disabled={!!busy}>
                  <Text className="text-xs font-semibold text-accent">{busy ? 'Retrying…' : 'Retry'}</Text>
                </Pressable>
              </View>
            )}

            <View className="flex-row items-center gap-2">
              <Text className="text-xs text-muted">Importing as {memberName}</Text>
              <Pressable onPress={() => setStep('member')} disabled={!!busy}>
                <Text className="text-xs font-semibold text-accent">Change</Text>
              </Pressable>
            </View>
            <Text className="text-xs text-muted">
              {rows.length} new expense{rows.length === 1 ? '' : 's'}
              {alreadyCount > 0 ? ` · ${alreadyCount} already imported` : ''}
              {skipped.length > 0 ? ` · ${skipped.length} skipped` : ''}
            </Text>
            {settlements.length > 0 && (
              <Text className="text-xs text-muted">
                Settled up: {settlements.map(t => `${t.description} ${fmt(t.amount)} on ${fmtDate(t.date)}`).join(' · ')}
              </Text>
            )}

            {rows.length === 0 ? (
              <Text className="text-sm text-ink-secondary">Nothing new to import from this file.</Text>
            ) : (
              <ScrollView style={{ maxHeight: 360 }}>
                {rows.map(r => {
                  const suggested = r.chosen !== null && r.chosen === r.category;
                  const low = suggested && r.source === 'laya' && (r.confidence ?? 1) < LOW_CONFIDENCE;
                  const remembered = suggested && r.source === 'memory';
                  return (
                    <View key={r.fingerprint} className="flex-row items-center gap-3 border-b border-surface py-2">
                      <Pressable
                        onPress={() => update(r.fingerprint, { include: !r.include })}
                        className="h-5 w-5 items-center justify-center rounded border border-border"
                        style={{ backgroundColor: r.include ? '#5b5cf6' : 'transparent' }}
                      >
                        {r.include && <Text className="text-[10px] text-white">✓</Text>}
                      </Pressable>
                      <View className="flex-[2]" style={{ opacity: r.include ? 1 : 0.4 }}>
                        <Text className="text-sm font-medium text-ink" numberOfLines={1}>
                          {r.description}
                        </Text>
                        <Text className="font-mono text-xs text-muted">
                          {fmtDate(r.date)} · {fmt(r.amount)}
                        </Text>
                      </View>
                      <View className="flex-[1.4] gap-0.5">
                        <Select
                          value={r.chosen ?? ''}
                          onChange={value => update(r.fingerprint, { chosen: value || null })}
                          options={[...(r.chosen ? [] : [{ label: 'Pick a category', value: '' }]), ...categoryOptions]}
                        />
                        {low && <Text className="text-[10px] font-medium text-[#ff9f0a]">Check this one</Text>}
                        {remembered && <Text className="text-[10px] text-muted">Remembered</Text>}
                      </View>
                    </View>
                  );
                })}
              </ScrollView>
            )}

            {skipped.length > 0 && (
              <View className="gap-1">
                <Pressable onPress={() => setShowSkipped(v => !v)}>
                  <Text className="text-xs font-medium text-accent">
                    {showSkipped ? 'Hide' : 'Show'} {skipped.length} skipped row{skipped.length === 1 ? '' : 's'}
                  </Text>
                </Pressable>
                {showSkipped &&
                  skipped.map(s => (
                    <Text key={s.line} className="text-xs text-muted">
                      Line {s.line}: {s.description}. {s.reason}.
                    </Text>
                  ))}
              </View>
            )}

            {rows.length > 0 && (
              <View className="gap-1">
                <Text className="text-xs font-medium uppercase tracking-widest text-ink-secondary">Record against</Text>
                <Select
                  value={accountId}
                  onChange={setAccountId}
                  groups={[
                    ...(banks.length > 0 ? [{ label: 'Accounts', options: banks.map(a => ({ label: shortName(a.name), value: a.id })) }] : []),
                    ...(cards.length > 0 ? [{ label: 'Credit Cards', options: cards.map(a => ({ label: a.name, value: a.id })) }] : []),
                  ]}
                />
              </View>
            )}

            {rows.length > 0 && (
              <Pressable onPress={submit} disabled={!!busy} className="rounded-xl bg-accent py-3" style={{ opacity: busy ? 0.5 : 1 }}>
                <Text className="text-center text-sm font-semibold text-white">
                  {busy ? 'Importing…' : `Import ${included.length} expense${included.length === 1 ? '' : 's'} · ${fmt(total)}`}
                </Text>
              </Pressable>
            )}
          </View>
        )}

        {step === 'done' && result && (
          <View className="gap-3">
            <Text className="text-sm text-ink">
              Imported {result.imported} expense{result.imported === 1 ? '' : 's'}.
              {result.skippedDuplicates > 0 ? ` ${result.skippedDuplicates} were already in your ledger.` : ''}
            </Text>
            <Pressable onPress={onClose} className="rounded-xl bg-accent py-3">
              <Text className="text-center text-sm font-semibold text-white">Done</Text>
            </Pressable>
          </View>
        )}

        {busy && (step === 'pick' || step === 'member') && <Text className="text-xs text-muted">{busy}</Text>}
        {error && <Text className="-mt-2 text-xs text-red">{error}</Text>}
      </View>
    </Overlay>
  );
}
