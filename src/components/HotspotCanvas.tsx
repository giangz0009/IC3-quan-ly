import React, { useRef, useState } from 'react';
import type { HotspotTarget, HotspotType } from '../types/ic3';

interface HotspotCanvasProps {
  hotspotType: HotspotType;
  target: HotspotTarget;
  editable?: boolean;
  onChangeTarget?: (next: HotspotTarget) => void;
}

export const HotspotCanvas: React.FC<HotspotCanvasProps> = ({
  hotspotType,
  target,
  editable = false,
  onChangeTarget,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null);

  function toPercent(clientX: number, clientY: number) {
    const el = containerRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    const x = Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100));
    const y = Math.min(100, Math.max(0, ((clientY - rect.top) / rect.height) * 100));
    return { x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) };
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!editable || !onChangeTarget) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const pt = toPercent(e.clientX, e.clientY);
    setDragStart(pt);
    setDragCurrent(pt);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!editable || !dragStart) return;
    setDragCurrent(toPercent(e.clientX, e.clientY));
  }

  function handlePointerUp() {
    if (!editable || !dragStart || !dragCurrent || !onChangeTarget) {
      setDragStart(null);
      setDragCurrent(null);
      return;
    }
    const minX = Number(Math.min(dragStart.x, dragCurrent.x).toFixed(1));
    const maxX = Number(Math.max(dragStart.x, dragCurrent.x).toFixed(1));
    const minY = Number(Math.min(dragStart.y, dragCurrent.y).toFixed(1));
    const maxY = Number(Math.max(dragStart.y, dragCurrent.y).toFixed(1));

    // If user just clicked instead of dragging, create an 8%x14% box around click
    if (maxX - minX < 2 || maxY - minY < 2) {
      onChangeTarget({
        ...target,
        minX: Number(Math.max(0, minX - 4).toFixed(1)),
        maxX: Number(Math.min(100, minX + 4).toFixed(1)),
        minY: Number(Math.max(0, minY - 7).toFixed(1)),
        maxY: Number(Math.min(100, minY + 7).toFixed(1)),
      });
    } else {
      onChangeTarget({ ...target, minX, minY, maxX, maxY });
    }
    setDragStart(null);
    setDragCurrent(null);
  }

  const previewBox =
    dragStart && dragCurrent
      ? {
          minX: Math.min(dragStart.x, dragCurrent.x),
          minY: Math.min(dragStart.y, dragCurrent.y),
          maxX: Math.max(dragStart.x, dragCurrent.x),
          maxY: Math.max(dragStart.y, dragCurrent.y),
        }
      : target;

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className={`relative w-full aspect-[16/7] rounded-lg border border-slate-300 dark:border-slate-700 overflow-hidden select-none bg-slate-100 dark:bg-slate-900 ${
          editable ? 'cursor-crosshair' : 'cursor-default'
        }`}
      >
        {renderMockInterface(hotspotType)}

        {/* Target Hotspot Box */}
        <div
          style={{
            left: `${previewBox.minX}%`,
            top: `${previewBox.minY}%`,
            width: `${Math.max(1, previewBox.maxX - previewBox.minX)}%`,
            height: `${Math.max(1, previewBox.maxY - previewBox.minY)}%`,
          }}
          className="absolute border-2 border-blue-600 bg-blue-500/20 dark:border-blue-400 dark:bg-blue-400/25 pointer-events-none rounded"
        >
          <span className="absolute -top-6 left-0 px-1.5 py-0.5 text-[11px] font-medium bg-blue-600 text-white rounded whitespace-nowrap shadow-sm">
            {target.label || 'Vùng đáp án'}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
        <span>
          {editable
            ? 'Kéo chuột trực tiếp trên ảnh mẫu để khoanh vùng tọa độ phần trăm.'
            : 'Vùng đáp án được cấu hình theo tọa độ phần trăm (dung sai ±1.5%).'}
        </span>
        <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
          X: {target.minX}%–{target.maxX}% · Y: {target.minY}%–{target.maxY}%
        </span>
      </div>
    </div>
  );
};

function renderMockInterface(type: HotspotType) {
  if (type === 'word_ribbon') {
    return (
      <svg viewBox="0 0 800 350" className="w-full h-full" aria-label="Microsoft Word Ribbon">
        <rect width="800" height="350" fill="#f8fafc" />
        <rect width="800" height="44" fill="#1e40af" />
        <text x="24" y="28" fill="#ffffff" fontSize="15" fontWeight="600" fontFamily="sans-serif">
          Microsoft Word — Tài liệu mới.docx
        </text>
        <rect x="0" y="44" width="800" height="38" fill="#eff6ff" />
        <text x="24" y="68" fill="#1e3a8a" fontSize="13" fontWeight="700" fontFamily="sans-serif">File</text>
        <rect x="72" y="48" width="66" height="34" rx="4" fill="#ffffff" />
        <text x="88" y="69" fill="#1d4ed8" fontSize="13" fontWeight="700" fontFamily="sans-serif">Home</text>
        <text x="160" y="69" fill="#475569" fontSize="13" fontFamily="sans-serif">Insert</text>
        <text x="224" y="69" fill="#475569" fontSize="13" fontFamily="sans-serif">Layout</text>
        <text x="296" y="69" fill="#475569" fontSize="13" fontFamily="sans-serif">References</text>

        <rect x="0" y="82" width="800" height="210" fill="#ffffff" stroke="#cbd5e1" />
        {/* Clipboard Group */}
        <rect x="16" y="96" width="168" height="178" rx="6" fill="#f8fafc" stroke="#cbd5e1" />
        <rect x="28" y="112" width="54" height="92" rx="4" fill="#e2e8f0" />
        <text x="39" y="164" fill="#0f172a" fontSize="12" fontWeight="600" fontFamily="sans-serif">Paste</text>
        <rect x="92" y="114" width="80" height="36" rx="4" fill="#e2e8f0" />
        <text x="102" y="137" fill="#0f172a" fontSize="12" fontFamily="sans-serif">Cut / Copy</text>
        <rect x="92" y="158" width="80" height="84" rx="4" fill="#dbeafe" stroke="#60a5fa" />
        <text x="101" y="196" fill="#1e3a8a" fontSize="11" fontWeight="700" fontFamily="sans-serif">Format</text>
        <text x="101" y="212" fill="#1e3a8a" fontSize="11" fontWeight="700" fontFamily="sans-serif">Painter</text>
        <text x="64" y="266" fill="#64748b" fontSize="11" fontFamily="sans-serif">Clipboard</text>

        {/* Font Group */}
        <rect x="198" y="96" width="248" height="178" rx="6" fill="#f8fafc" stroke="#cbd5e1" />
        <rect x="214" y="114" width="142" height="32" rx="4" fill="#ffffff" stroke="#94a3b8" />
        <text x="224" y="135" fill="#0f172a" fontSize="12" fontFamily="sans-serif">Calibri (Body)</text>
        <rect x="364" y="114" width="66" height="32" rx="4" fill="#ffffff" stroke="#94a3b8" />
        <text x="382" y="135" fill="#0f172a" fontSize="12" fontFamily="sans-serif">12 pt</text>
        <rect x="214" y="164" width="38" height="38" rx="4" fill="#e2e8f0" />
        <text x="228" y="189" fill="#0f172a" fontSize="15" fontWeight="700" fontFamily="sans-serif">B</text>
        <rect x="260" y="164" width="38" height="38" rx="4" fill="#e2e8f0" />
        <text x="276" y="189" fill="#0f172a" fontSize="15" fontStyle="italic" fontFamily="serif">I</text>
        <rect x="306" y="164" width="38" height="38" rx="4" fill="#e2e8f0" />
        <text x="320" y="189" fill="#0f172a" fontSize="15" textDecoration="underline" fontFamily="sans-serif">U</text>
        <text x="304" y="266" fill="#64748b" fontSize="11" fontFamily="sans-serif">Font</text>

        {/* Paragraph Group */}
        <rect x="460" y="96" width="324" height="178" rx="6" fill="#f8fafc" stroke="#cbd5e1" />
        <rect x="480" y="118" width="128" height="44" rx="4" fill="#e2e8f0" />
        <text x="494" y="145" fill="#0f172a" fontSize="12" fontFamily="sans-serif">Bullets &amp; Lists</text>
        <rect x="480" y="176" width="128" height="44" rx="4" fill="#e2e8f0" />
        <text x="504" y="203" fill="#0f172a" fontSize="12" fontFamily="sans-serif">Align Left / Center</text>
        <rect x="626" y="118" width="138" height="102" rx="4" fill="#e2e8f0" />
        <text x="646" y="174" fill="#0f172a" fontSize="12" fontFamily="sans-serif">Line Spacing</text>
        <text x="595" y="266" fill="#64748b" fontSize="11" fontFamily="sans-serif">Paragraph</text>
      </svg>
    );
  }

  if (type === 'excel_ribbon') {
    return (
      <svg viewBox="0 0 800 350" className="w-full h-full" aria-label="Microsoft Excel Ribbon">
        <rect width="800" height="350" fill="#f8fafc" />
        <rect width="800" height="44" fill="#15803d" />
        <text x="24" y="28" fill="#ffffff" fontSize="15" fontWeight="600" fontFamily="sans-serif">
          Microsoft Excel — Bang_Diem_IC3.xlsx
        </text>
        <rect x="0" y="44" width="800" height="38" fill="#f0fdf4" />
        <rect x="72" y="48" width="66" height="34" rx="4" fill="#ffffff" />
        <text x="88" y="69" fill="#15803d" fontSize="13" fontWeight="700" fontFamily="sans-serif">Home</text>
        <text x="160" y="69" fill="#475569" fontSize="13" fontFamily="sans-serif">Insert</text>
        <text x="224" y="69" fill="#475569" fontSize="13" fontFamily="sans-serif">Formulas</text>
        <text x="310" y="69" fill="#475569" fontSize="13" fontFamily="sans-serif">Data</text>

        <rect x="0" y="82" width="800" height="210" fill="#ffffff" stroke="#cbd5e1" />
        <rect x="18" y="98" width="190" height="176" rx="6" fill="#f8fafc" stroke="#cbd5e1" />
        <text x="84" y="184" fill="#0f172a" fontSize="13" fontWeight="600" fontFamily="sans-serif">Font Group</text>
        <text x="72" y="264" fill="#64748b" fontSize="11" fontFamily="sans-serif">Clipboard &amp; Font</text>

        <rect x="222" y="98" width="300" height="176" rx="6" fill="#f8fafc" stroke="#cbd5e1" />
        <rect x="240" y="114" width="114" height="40" rx="4" fill="#e2e8f0" />
        <text x="255" y="139" fill="#0f172a" fontSize="12" fontFamily="sans-serif">Align Top/Mid</text>
        <rect x="370" y="114" width="136" height="40" rx="4" fill="#e2e8f0" />
        <text x="394" y="139" fill="#0f172a" fontSize="12" fontFamily="sans-serif">Wrap Text</text>
        <rect x="370" y="170" width="136" height="68" rx="4" fill="#dcfce7" stroke="#22c55e" />
        <text x="385" y="209" fill="#166534" fontSize="13" fontWeight="700" fontFamily="sans-serif">Merge &amp; Center</text>
        <text x="345" y="264" fill="#64748b" fontSize="11" fontFamily="sans-serif">Alignment</text>

        <rect x="536" y="98" width="246" height="176" rx="6" fill="#f8fafc" stroke="#cbd5e1" />
        <rect x="556" y="118" width="206" height="40" rx="4" fill="#e2e8f0" />
        <text x="612" y="143" fill="#0f172a" fontSize="12" fontFamily="sans-serif">General / Number</text>
        <rect x="556" y="172" width="96" height="58" rx="4" fill="#e2e8f0" />
        <text x="582" y="206" fill="#0f172a" fontSize="12" fontFamily="sans-serif">% / ,</text>
        <rect x="666" y="172" width="96" height="58" rx="4" fill="#e2e8f0" />
        <text x="688" y="206" fill="#0f172a" fontSize="12" fontFamily="sans-serif">AutoSum</text>
        <text x="635" y="264" fill="#64748b" fontSize="11" fontFamily="sans-serif">Number &amp; Editing</text>
      </svg>
    );
  }

  if (type === 'pc_hardware_ports') {
    return (
      <svg viewBox="0 0 800 350" className="w-full h-full" aria-label="PC Hardware Rear Panel Ports">
        <rect width="800" height="350" fill="#1e293b" />
        <rect x="28" y="28" width="744" height="294" rx="10" fill="#334155" stroke="#475569" strokeWidth="2" />
        <text x="52" y="64" fill="#e2e8f0" fontSize="14" fontWeight="600" fontFamily="sans-serif">
          Bảng Cổng Kết Nối Mặt Sau Máy Tính (I/O Shield)
        </text>
        {/* USB 3.0 */}
        <rect x="62" y="106" width="128" height="122" rx="6" fill="#0f172a" stroke="#64748b" />
        <rect x="82" y="128" width="88" height="26" rx="2" fill="#2563eb" />
        <rect x="82" y="172" width="88" height="26" rx="2" fill="#2563eb" />
        <text x="92" y="254" fill="#cbd5e1" fontSize="12" fontWeight="600" fontFamily="sans-serif">USB 3.0</text>

        {/* HDMI & DisplayPort */}
        <rect x="224" y="106" width="186" height="122" rx="6" fill="#0f172a" stroke="#64748b" />
        <polygon points="244,132 318,132 318,158 308,166 254,166 244,158" fill="#475569" stroke="#94a3b8" />
        <text x="262" y="196" fill="#cbd5e1" fontSize="12" fontWeight="600" fontFamily="sans-serif">HDMI</text>
        <rect x="336" y="132" width="56" height="34" rx="3" fill="#475569" stroke="#94a3b8" />
        <text x="348" y="196" fill="#cbd5e1" fontSize="12" fontWeight="600" fontFamily="sans-serif">USB-C</text>

        {/* RJ-45 Ethernet */}
        <rect x="444" y="106" width="136" height="122" rx="6" fill="#0f172a" stroke="#38bdf8" strokeWidth="2" />
        <rect x="472" y="128" width="80" height="66" rx="4" fill="#1e293b" stroke="#94a3b8" />
        <rect x="494" y="118" width="36" height="14" fill="#f59e0b" />
        <text x="456" y="254" fill="#e2e8f0" fontSize="12" fontWeight="700" fontFamily="sans-serif">Ethernet (RJ-45)</text>

        {/* Audio Jacks */}
        <rect x="614" y="106" width="128" height="122" rx="6" fill="#0f172a" stroke="#64748b" />
        <circle cx="652" cy="144" r="16" fill="#22c55e" stroke="#e2e8f0" strokeWidth="2" />
        <circle cx="704" cy="144" r="16" fill="#ec4899" stroke="#e2e8f0" strokeWidth="2" />
        <circle cx="678" cy="194" r="16" fill="#3b82f6" stroke="#e2e8f0" strokeWidth="2" />
        <text x="640" y="254" fill="#cbd5e1" fontSize="12" fontWeight="600" fontFamily="sans-serif">Audio 3.5mm</text>
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 800 350" className="w-full h-full" aria-label="Browser Security Bar">
      <rect width="800" height="350" fill="#f1f5f9" />
      <rect x="24" y="24" width="752" height="302" rx="10" fill="#ffffff" stroke="#cbd5e1" />
      {/* Tab bar */}
      <rect x="24" y="24" width="752" height="54" rx="10" fill="#e2e8f0" />
      <rect x="44" y="34" width="210" height="44" rx="6" fill="#ffffff" />
      <text x="66" y="61" fill="#0f172a" fontSize="13" fontWeight="600" fontFamily="sans-serif">
        Cổng thi IC3 Trực tuyến
      </text>
      {/* Address Bar */}
      <rect x="24" y="78" width="752" height="84" fill="#ffffff" stroke="#e2e8f0" />
      <circle cx="64" cy="120" r="16" fill="#f1f5f9" />
      <text x="58" y="125" fill="#475569" fontSize="16" fontFamily="sans-serif">←</text>
      <circle cx="106" cy="120" r="16" fill="#f1f5f9" />
      <text x="100" y="125" fill="#475569" fontSize="16" fontFamily="sans-serif">→</text>
      <circle cx="148" cy="120" r="16" fill="#f1f5f9" />
      <text x="142" y="125" fill="#475569" fontSize="16" fontFamily="sans-serif">↻</text>

      <rect x="176" y="96" width="486" height="48" rx="24" fill="#f8fafc" stroke="#94a3b8" />
      {/* Lock Icon Zone */}
      <rect x="188" y="104" width="38" height="32" rx="6" fill="#dcfce7" stroke="#16a34a" />
      <rect x="200" y="118" width="14" height="11" rx="2" fill="#16a34a" />
      <path d="M203 118 V114 A4 4 0 0 1 211 114 V118" fill="none" stroke="#16a34a" strokeWidth="2.2" />
      <text x="238" y="125" fill="#0f172a" fontSize="14" fontFamily="monospace">
        https://thi-ic3.edu.vn/phong-thi
      </text>

      {/* Bookmark star & Profile */}
      <rect x="678" y="102" width="36" height="36" rx="6" fill="#f1f5f9" />
      <text x="690" y="125" fill="#eab308" fontSize="16" fontFamily="sans-serif">★</text>
      <rect x="724" y="102" width="36" height="36" rx="18" fill="#dbeafe" />
      <text x="735" y="125" fill="#1d4ed8" fontSize="13" fontWeight="700" fontFamily="sans-serif">HS</text>

      <rect x="52" y="188" width="696" height="112" rx="8" fill="#f8fafc" stroke="#e2e8f0" />
      <text x="78" y="232" fill="#0f172a" fontSize="16" fontWeight="600" fontFamily="sans-serif">
        Chứng chỉ kết nối an toàn (SSL / TLS)
      </text>
      <text x="78" y="262" fill="#475569" fontSize="13" fontFamily="sans-serif">
        Trình duyệt xác nhận dữ liệu bài thi được mã hóa đầu cuối qua giao thức HTTPS.
      </text>
    </svg>
  );
}
