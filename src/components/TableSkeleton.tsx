import React from 'react';

export interface TableSkeletonColumn {
  header?: string;
  align?: 'left' | 'center' | 'right';
  variant?: 'text' | 'twoLine' | 'mono' | 'iconBox' | 'actions';
  widths?: string[];
  cellClassName?: string;
  headerClassName?: string;
}

const DEFAULT_WIDTHS = ['w-28', 'w-40', 'w-24', 'w-36', 'w-32'];

function pickBarWidth(
  col: TableSkeletonColumn,
  rowIdx: number,
  colIdx: number
): string {
  const pool = col.widths && col.widths.length > 0 ? col.widths : DEFAULT_WIDTHS;
  return pool[(rowIdx * 3 + colIdx) % pool.length];
}

interface TableSkeletonRowsProps {
  columns: TableSkeletonColumn[];
  rows?: number;
  rowHeightClass?: string;
  testId?: string;
  ariaLabel?: string;
}

export const TableSkeletonRows: React.FC<TableSkeletonRowsProps> = ({
  columns,
  rows = 6,
  rowHeightClass = 'h-11',
  testId = 'table-skeleton',
  ariaLabel = 'Đang tải dữ liệu bảng...',
}) => {
  return (
    <tbody
      aria-busy="true"
      data-testid={testId}
      className="divide-y divide-slate-100 dark:divide-slate-800"
    >
      <tr className="sr-only" role="status" aria-live="polite">
        <td colSpan={columns.length}>{ariaLabel}</td>
      </tr>
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <tr key={rowIdx} className={rowHeightClass}>
          {columns.map((col, colIdx) => {
            const align = col.align ?? 'left';
            const alignMargin =
              align === 'right'
                ? 'ml-auto'
                : align === 'center'
                  ? 'mx-auto'
                  : '';
            const barWidth = pickBarWidth(col, rowIdx, colIdx);
            const cellClass = col.cellClassName ?? 'py-2.5 pr-4';

            return (
              <td key={colIdx} className={cellClass}>
                {col.variant === 'twoLine' ? (
                  <div className="space-y-1.5 py-0.5">
                    <div
                      className={`h-3.5 max-w-full rounded bg-slate-200 dark:bg-slate-800 motion-safe:animate-pulse ${barWidth}`}
                    />
                    <div className="h-2.5 w-36 max-w-full rounded bg-slate-100 dark:bg-slate-800/70 motion-safe:animate-pulse" />
                  </div>
                ) : col.variant === 'iconBox' ? (
                  <div
                    className={`w-8 h-8 rounded-lg bg-slate-200 dark:bg-slate-800 motion-safe:animate-pulse ${alignMargin}`}
                  />
                ) : col.variant === 'actions' ? (
                  <div
                    className={`flex items-center gap-2.5 ${
                      align === 'right'
                        ? 'justify-end'
                        : align === 'center'
                          ? 'justify-center'
                          : 'justify-start'
                    }`}
                  >
                    <div className="h-3.5 w-10 rounded bg-slate-200 dark:bg-slate-800 motion-safe:animate-pulse" />
                    <div className="h-3.5 w-12 rounded bg-slate-100 dark:bg-slate-800/70 motion-safe:animate-pulse" />
                  </div>
                ) : col.variant === 'mono' ? (
                  <div
                    className={`h-3 max-w-full rounded bg-slate-200/90 dark:bg-slate-800 motion-safe:animate-pulse ${barWidth} ${alignMargin}`}
                  />
                ) : (
                  <div
                    className={`h-3.5 max-w-full rounded bg-slate-200 dark:bg-slate-800 motion-safe:animate-pulse ${barWidth} ${alignMargin}`}
                  />
                )}
              </td>
            );
          })}
        </tr>
      ))}
    </tbody>
  );
};

interface TableSkeletonCardProps {
  title?: string;
  subtitle?: string;
  columns: TableSkeletonColumn[];
  rows?: number;
  rowHeightClass?: string;
  testId?: string;
  ariaLabel?: string;
}

export const TableSkeletonCard: React.FC<TableSkeletonCardProps> = ({
  title,
  subtitle,
  columns,
  rows = 6,
  rowHeightClass = 'h-11',
  testId = 'table-skeleton',
  ariaLabel = 'Đang tải dữ liệu bảng...',
}) => {
  return (
    <section
      aria-label={ariaLabel}
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4"
    >
      {(title || subtitle) && (
        <div className="space-y-2">
          {title ? (
            <div className="h-4 w-56 max-w-full rounded bg-slate-200 dark:bg-slate-800 motion-safe:animate-pulse" />
          ) : null}
          {subtitle ? (
            <div className="h-3 w-80 max-w-full rounded bg-slate-100 dark:bg-slate-800/70 motion-safe:animate-pulse" />
          ) : null}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 whitespace-nowrap">
              {columns.map((col, idx) => (
                <th
                  key={idx}
                  className={
                    col.headerClassName ??
                    `py-2.5 pr-4 font-medium ${
                      col.align === 'right'
                        ? 'text-right'
                        : col.align === 'center'
                          ? 'text-center'
                          : 'text-left'
                    }`
                  }
                >
                  {col.header ?? (
                    <span className="inline-block h-3 w-20 rounded bg-slate-200 dark:bg-slate-800 motion-safe:animate-pulse" />
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <TableSkeletonRows
            columns={columns}
            rows={rows}
            rowHeightClass={rowHeightClass}
            testId={testId}
            ariaLabel={ariaLabel}
          />
        </table>
      </div>
    </section>
  );
};

interface CardGridSkeletonProps {
  count?: number;
  columnsClassName?: string;
  testId?: string;
  ariaLabel?: string;
}

export const CardGridSkeleton: React.FC<CardGridSkeletonProps> = ({
  count = 6,
  columnsClassName = 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4',
  testId = 'card-grid-skeleton',
  ariaLabel = 'Đang tải danh sách thẻ...',
}) => {
  return (
    <div
      role="status"
      aria-busy="true"
      data-testid={testId}
      className={`grid ${columnsClassName}`}
    >
      <span className="sr-only">{ariaLabel}</span>
      {Array.from({ length: count }).map((_, idx) => (
        <div
          key={idx}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl flex flex-col justify-between overflow-hidden"
        >
          <div className="p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="h-3 w-20 rounded bg-slate-200 dark:bg-slate-800 motion-safe:animate-pulse" />
              <div className="h-3 w-24 rounded bg-slate-100 dark:bg-slate-800/70 motion-safe:animate-pulse" />
            </div>
            <div className="h-4 w-3/4 rounded bg-slate-200 dark:bg-slate-800 motion-safe:animate-pulse" />
            <div className="h-3 w-5/6 rounded bg-slate-100 dark:bg-slate-800/70 motion-safe:animate-pulse" />
          </div>
          <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="h-6 w-12 rounded-md bg-slate-100 dark:bg-slate-800/70 motion-safe:animate-pulse" />
              <div className="h-6 w-12 rounded-md bg-slate-100 dark:bg-slate-800/70 motion-safe:animate-pulse" />
            </div>
            <div className="h-3.5 w-24 rounded bg-slate-200 dark:bg-slate-800 motion-safe:animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
};

interface ListSkeletonProps {
  rows?: number;
  variant?: 'compact' | 'detailed' | 'questionCard';
  testId?: string;
  ariaLabel?: string;
}

export const ListSkeleton: React.FC<ListSkeletonProps> = ({
  rows = 5,
  variant = 'compact',
  testId = 'list-skeleton',
  ariaLabel = 'Đang tải danh sách...',
}) => {
  if (variant === 'questionCard') {
    return (
      <div
        role="status"
        aria-busy="true"
        data-testid={testId}
        className="space-y-4"
      >
        <span className="sr-only">{ariaLabel}</span>
        {Array.from({ length: rows }).map((_, idx) => (
          <div
            key={idx}
            className="rounded-xl p-5 space-y-3 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2 flex-1 max-w-2xl">
                <div className="h-3 w-64 max-w-full rounded bg-slate-100 dark:bg-slate-800/70 motion-safe:animate-pulse" />
                <div className="h-4 w-5/6 rounded bg-slate-200 dark:bg-slate-800 motion-safe:animate-pulse" />
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <div className="h-7 w-14 rounded-lg bg-slate-100 dark:bg-slate-800/70 motion-safe:animate-pulse" />
                <div className="h-7 w-14 rounded-lg bg-slate-100 dark:bg-slate-800/70 motion-safe:animate-pulse" />
              </div>
            </div>
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
              <div className="h-3 w-48 rounded bg-slate-100 dark:bg-slate-800/70 motion-safe:animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (variant === 'detailed') {
    return (
      <div
        role="status"
        aria-busy="true"
        data-testid={testId}
        className="divide-y divide-slate-100 dark:divide-slate-800"
      >
        <span className="sr-only">{ariaLabel}</span>
        {Array.from({ length: rows }).map((_, idx) => (
          <div key={idx} className="py-4 space-y-2.5">
            <div className="flex items-center justify-between gap-4">
              <div className="h-3.5 w-48 max-w-full rounded bg-slate-200 dark:bg-slate-800 motion-safe:animate-pulse" />
              <div className="h-3 w-32 rounded bg-slate-100 dark:bg-slate-800/70 motion-safe:animate-pulse" />
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-1 h-2 rounded-full bg-slate-100 dark:bg-slate-800 motion-safe:animate-pulse" />
              <div className="h-3 w-20 rounded bg-slate-200 dark:bg-slate-800 motion-safe:animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-busy="true"
      data-testid={testId}
      className="divide-y divide-slate-100 dark:divide-slate-800"
    >
      <span className="sr-only">{ariaLabel}</span>
      {Array.from({ length: rows }).map((_, idx) => (
        <div
          key={idx}
          className="py-3 flex items-center justify-between gap-3"
        >
          <div className="space-y-1.5 flex-1 min-w-0">
            <div className="h-3.5 w-44 max-w-full rounded bg-slate-200 dark:bg-slate-800 motion-safe:animate-pulse" />
            <div className="h-2.5 w-56 max-w-full rounded bg-slate-100 dark:bg-slate-800/70 motion-safe:animate-pulse" />
          </div>
          <div className="space-y-1.5 shrink-0 text-right">
            <div className="h-3.5 w-12 ml-auto rounded bg-slate-200 dark:bg-slate-800 motion-safe:animate-pulse" />
            <div className="h-2.5 w-16 ml-auto rounded bg-slate-100 dark:bg-slate-800/70 motion-safe:animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
};
