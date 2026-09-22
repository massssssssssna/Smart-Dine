'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Calendar,
  ChevronDown,
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  X,
} from 'lucide-react';
import { downloadReport } from '@/lib/api';
import styles from './history-export-toolbar.module.css';

export type PresetType = 'today' | '7d' | '21d' | '30d' | '180d' | 'custom';

export type HistoryExportToolbarProps = {
  portal: 'manager' | 'cashier' | 'waiter' | 'kitchen';
  totalRecords: number;
  searchQuery?: string;
  statusFilter?: string;
  onDateRangeChange?: (startDate: string, endDate: string, preset: PresetType) => void;
  defaultPreset?: PresetType;
};

function getKarachiDate(offsetDays: number = 0): string {
  const d = new Date();
  if (offsetDays !== 0) {
    d.setDate(d.getDate() + offsetDays);
  }
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function formatDisplayDate(iso: string): string {
  if (!iso) return '';
  const parts = iso.split('-');
  if (parts.length !== 3) return iso;
  const [y, m, d] = parts;
  const dateObj = new Date(Number(y), Number(m) - 1, Number(d));
  return dateObj.toLocaleDateString('en-PK', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function HistoryExportToolbar({
  portal,
  totalRecords,
  searchQuery = '',
  statusFilter = 'all',
  onDateRangeChange,
  defaultPreset = '30d',
}: HistoryExportToolbarProps) {
  const [preset, setPreset] = useState<PresetType>(defaultPreset);
  const [startDate, setStartDate] = useState<string>(() => {
    if (defaultPreset === 'today') return getKarachiDate(0);
    if (defaultPreset === '7d') return getKarachiDate(-6);
    if (defaultPreset === '21d') return getKarachiDate(-20);
    if (defaultPreset === '180d') return getKarachiDate(-179);
    return getKarachiDate(-29);
  });
  const [endDate, setEndDate] = useState<string>(() => getKarachiDate(0));

  const [menuOpen, setMenuOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportType, setExportType] = useState<'pdf' | 'excel' | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  const menuRef = useRef<HTMLDivElement>(null);

  // Notify initial date range on mount
  useEffect(() => {
    onDateRangeChange?.(startDate, endDate, preset);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function handleSelectPreset(p: PresetType) {
    setPreset(p);
    let s = startDate;
    const e = getKarachiDate(0);

    if (p === 'today') s = getKarachiDate(0);
    else if (p === '7d') s = getKarachiDate(-6);
    else if (p === '21d') s = getKarachiDate(-20);
    else if (p === '30d') s = getKarachiDate(-29);
    else if (p === '180d') s = getKarachiDate(-179);

    if (p !== 'custom') {
      setStartDate(s);
      setEndDate(e);
      onDateRangeChange?.(s, e, p);
    }
  }

  function handleCustomDateChange(newStart: string, newEnd: string) {
    setStartDate(newStart);
    setEndDate(newEnd);
    if (newStart && newEnd && newStart <= newEnd) {
      onDateRangeChange?.(newStart, newEnd, 'custom');
    }
  }

  async function handleDownload(format: 'pdf' | 'excel') {
    setIsExporting(true);
    setExportType(format);
    setMenuOpen(false);
    setErrorMessage('');

    try {
      const scopeTag = portal.charAt(0).toUpperCase() + portal.slice(1);
      const cleanStart = startDate.replace(/-/g, '');
      const cleanEnd = endDate.replace(/-/g, '');
      const ext = format === 'pdf' ? 'pdf' : 'xlsx';
      const defaultFilename = `SmartDine_${scopeTag}_History_${cleanStart}_${cleanEnd}.${ext}`;

      const params = new URLSearchParams({
        format,
        start_date: startDate,
        end_date: endDate,
        status: statusFilter || 'all',
        q: searchQuery.trim(),
        scope: portal,
      });

      await downloadReport(`orders/export?${params.toString()}`, defaultFilename);
    } catch (err) {
      setErrorMessage((err as Error)?.message || 'Export failed. Please check network connection.');
    } finally {
      setIsExporting(false);
      setExportType(null);
    }
  }

  const dateSummaryLabel =
    startDate === endDate
      ? `${formatDisplayDate(startDate)} · ${totalRecords} records`
      : `${formatDisplayDate(startDate)} – ${formatDisplayDate(endDate)} · ${totalRecords} records`;

  return (
    <div className={styles.toolbarContainer}>
      <div className={styles.controlsLeft}>
        <div className={styles.presetsGroup} role="group" aria-label="Date range presets">
          {(portal === 'manager'
            ? [
                { id: 'today' as const, label: 'Today' },
                { id: '7d' as const, label: 'Last 7 days' },
                { id: '30d' as const, label: 'Last 30 days' },
                { id: '180d' as const, label: 'All (6 Mo)' },
                { id: 'custom' as const, label: 'Custom range' },
              ]
            : [
                { id: 'today' as const, label: 'Today' },
                { id: '7d' as const, label: 'Last 7 days' },
                { id: '21d' as const, label: 'Last 21 days' },
                { id: '30d' as const, label: 'Last 30 days' },
                { id: 'custom' as const, label: 'Custom range' },
              ]
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              className={`${styles.presetBtn} ${preset === item.id ? styles.presetBtnActive : ''}`}
              onClick={() => handleSelectPreset(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        {preset === 'custom' && (
          <div className={styles.customDateBox} aria-label="Select custom dates">
            <input
              type="date"
              aria-label="Start date"
              value={startDate}
              max={endDate || getKarachiDate(0)}
              onChange={(e) => handleCustomDateChange(e.target.value, endDate)}
            />
            <span className={styles.dateSep}>to</span>
            <input
              type="date"
              aria-label="End date"
              value={endDate}
              min={startDate}
              max={getKarachiDate(0)}
              onChange={(e) => handleCustomDateChange(startDate, e.target.value)}
            />
          </div>
        )}

        <div className={styles.recordsBadge} title="Asia/Karachi inclusive reporting window">
          <Calendar size={13} />
          <span>{dateSummaryLabel}</span>
        </div>
      </div>

      <div className={styles.controlsRight}>
        <div className={styles.exportBtnWrap} ref={menuRef}>
          <button
            type="button"
            className={styles.exportTriggerBtn}
            onClick={() => setMenuOpen((prev) => !prev)}
            disabled={isExporting}
            aria-expanded={menuOpen}
            aria-haspopup="true"
          >
            {isExporting ? (
              <>
                <Loader2 size={14} className={styles.spinner} />
                <span>Generating {exportType?.toUpperCase()}…</span>
              </>
            ) : (
              <>
                <Download size={14} />
                <span>Export</span>
                <ChevronDown size={13} />
              </>
            )}
          </button>

          {menuOpen && (
            <div className={styles.dropdownMenu} role="menu">
              <button
                type="button"
                className={styles.menuOption}
                onClick={() => void handleDownload('pdf')}
                role="menuitem"
              >
                <FileText size={16} className={styles.menuOptionIcon} />
                <div className={styles.menuOptionText}>
                  <strong>Download PDF</strong>
                  <small>Landscape summary, clean wrapped tables</small>
                </div>
              </button>

              <button
                type="button"
                className={styles.menuOption}
                onClick={() => void handleDownload('excel')}
                role="menuitem"
              >
                <FileSpreadsheet size={16} className={styles.menuOptionIcon} />
                <div className={styles.menuOptionText}>
                  <strong>Download Excel (.xlsx)</strong>
                  <small>3 Sheets: Summary, History &amp; Line Items</small>
                </div>
              </button>
            </div>
          )}
        </div>
      </div>

      {errorMessage && (
        <div className={styles.errorBanner} role="alert">
          <span>{errorMessage}</span>
          <button
            type="button"
            className={styles.errorClose}
            onClick={() => setErrorMessage('')}
            aria-label="Dismiss error"
          >
            <X size={12} />
          </button>
        </div>
      )}
    </div>
  );
}
