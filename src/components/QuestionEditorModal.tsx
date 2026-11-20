import React, { useState } from 'react';
import { Loader2, Plus, Trash2, X } from 'lucide-react';
import {
  CATEGORY_LABELS,
  HOTSPOT_TYPE_LABELS,
  MODULE_LABELS,
  QUESTION_TYPE_LABELS,
  type DifficultyLevel,
  type HotspotTarget,
  type HotspotType,
  type IC3Level,
  type IC3Module,
  type IC3ModuleRecord,
  type KnowledgeCategory,
  type KnowledgeCategoryRecord,
  type KnowledgePart,
  type MatchingItem,
  type MatchingPair,
  type Question,
  type QuestionOption,
  type QuestionPayload,
  type QuestionType,
  type TrueFalseStatement,
} from '../types/ic3';
import { HotspotCanvas } from './HotspotCanvas';

export interface QuestionDefaultContext {
  module: IC3Module;
  level: IC3Level;
  category: KnowledgeCategory;
  contentCode: string;
  topicOrder: number;
}

interface QuestionEditorModalProps {
  initialQuestion: Question | null;
  defaultContext?: QuestionDefaultContext;
  availableModules?: IC3ModuleRecord[];
  availableCategories?: KnowledgeCategoryRecord[];
  availableParts?: KnowledgePart[];
  onClose: () => void;
  onSave: (payload: Omit<Question, 'id' | 'createdAt' | 'updatedAt'>, existingId?: string) => Promise<void>;
}

export const QuestionEditorModal: React.FC<QuestionEditorModalProps> = ({
  initialQuestion,
  defaultContext,
  availableModules = [],
  availableCategories = [],
  availableParts = [],
  onClose,
  onSave,
}) => {
  const [module, setModule] = useState<IC3Module>(
    initialQuestion?.module ?? defaultContext?.module ?? 'computing_fundamentals'
  );
  const [level, setLevel] = useState<IC3Level>(
    initialQuestion?.level ?? defaultContext?.level ?? 'LV1'
  );
  const [category, setCategory] = useState<KnowledgeCategory>(
    initialQuestion?.category ?? defaultContext?.category ?? 'GM'
  );
  const [contentCode, setContentCode] = useState<string>(
    initialQuestion?.contentCode ?? defaultContext?.contentCode ?? 'GM1'
  );
  const [topicOrder, setTopicOrder] = useState<number>(
    initialQuestion?.topicOrder ?? defaultContext?.topicOrder ?? 1
  );
  const [topic, setTopic] = useState(initialQuestion?.topic ?? 'Phần cứng & Hệ điều hành');
  const [difficulty, setDifficulty] = useState<DifficultyLevel>(
    initialQuestion?.difficulty ?? 'medium'
  );
  const [type, setType] = useState<QuestionType>(initialQuestion?.type ?? 'single');
  const [prompt, setPrompt] = useState(initialQuestion?.prompt ?? '');
  const [instruction, setInstruction] = useState(initialQuestion?.instruction ?? '');
  const [explanation, setExplanation] = useState(initialQuestion?.explanation ?? '');
  const [tips, setTips] = useState(initialQuestion?.tips ?? '');

  // Type-specific states
  const initialPayload = initialQuestion?.payload;
  const [options, setOptions] = useState<QuestionOption[]>(
    initialPayload && 'options' in initialPayload
      ? initialPayload.options
      : [
          { id: 'opt_1', text: '' },
          { id: 'opt_2', text: '' },
          { id: 'opt_3', text: '' },
          { id: 'opt_4', text: '' },
        ]
  );
  const [correctOptionId, setCorrectOptionId] = useState<string>(
    initialPayload && 'correctOptionId' in initialPayload
      ? initialPayload.correctOptionId
      : 'opt_1'
  );
  const [correctOptionIds, setCorrectOptionIds] = useState<string[]>(
    initialPayload && 'correctOptionIds' in initialPayload
      ? initialPayload.correctOptionIds
      : ['opt_1']
  );

  const [statements, setStatements] = useState<TrueFalseStatement[]>(
    initialPayload && 'statements' in initialPayload
      ? initialPayload.statements
      : [
          { id: 'st_1', text: '', isTrue: true },
          { id: 'st_2', text: '', isTrue: false },
        ]
  );

  const [matchingLeft, setMatchingLeft] = useState<MatchingItem[]>(
    initialPayload && 'matchingLeft' in initialPayload
      ? initialPayload.matchingLeft
      : [
          { id: 'l1', text: '' },
          { id: 'l2', text: '' },
          { id: 'l3', text: '' },
        ]
  );
  const [matchingRight, setMatchingRight] = useState<MatchingItem[]>(
    initialPayload && 'matchingRight' in initialPayload
      ? initialPayload.matchingRight
      : [
          { id: 'r1', text: '' },
          { id: 'r2', text: '' },
          { id: 'r3', text: '' },
        ]
  );
  const [correctPairs, setCorrectPairs] = useState<MatchingPair[]>(
    initialPayload && 'correctPairs' in initialPayload
      ? initialPayload.correctPairs
      : [
          { leftId: 'l1', rightId: 'r1' },
          { leftId: 'l2', rightId: 'r2' },
          { leftId: 'l3', rightId: 'r3' },
        ]
  );

  const [hotspotType, setHotspotType] = useState<HotspotType>(
    initialPayload && 'hotspotType' in initialPayload
      ? initialPayload.hotspotType
      : 'word_ribbon'
  );
  const [hotspotTarget, setHotspotTarget] = useState<HotspotTarget>(
    initialPayload && 'hotspotTarget' in initialPayload
      ? initialPayload.hotspotTarget
      : {
          label: 'Vùng đáp án',
          minX: 20,
          minY: 35,
          maxX: 35,
          maxY: 60,
        }
  );
  const [imageAlt, setImageAlt] = useState(
    initialPayload && 'imageAlt' in initialPayload
      ? initialPayload.imageAlt
      : 'Ảnh giao diện IC3'
  );

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function buildPayload(): QuestionPayload | null {
    if (type === 'single') {
      const cleanOpts = options.filter((o) => o.text.trim());
      if (cleanOpts.length < 2) {
        setError('Cần nhập ít nhất 2 phương án trả lời.');
        return null;
      }
      const validCorrect = cleanOpts.some((o) => o.id === correctOptionId)
        ? correctOptionId
        : cleanOpts[0].id;
      return { options: cleanOpts, correctOptionId: validCorrect };
    }

    if (type === 'multiple') {
      const cleanOpts = options.filter((o) => o.text.trim());
      if (cleanOpts.length < 2) {
        setError('Cần nhập ít nhất 2 phương án trả lời.');
        return null;
      }
      const validIds = correctOptionIds.filter((id) =>
        cleanOpts.some((o) => o.id === id)
      );
      if (validIds.length === 0) {
        setError('Phải chọn ít nhất 1 đáp án đúng.');
        return null;
      }
      return { options: cleanOpts, correctOptionIds: validIds };
    }

    if (type === 'true_false') {
      const cleanStmts = statements.filter((s) => s.text.trim());
      if (cleanStmts.length === 0) {
        setError('Cần nhập ít nhất 1 ý phát biểu Đúng/Sai.');
        return null;
      }
      return { statements: cleanStmts };
    }

    if (type === 'matching') {
      const cleanL = matchingLeft.filter((l) => l.text.trim());
      const cleanR = matchingRight.filter((r) => r.text.trim());
      if (cleanL.length < 2 || cleanR.length < 2) {
        setError('Cần ít nhất 2 mục ở mỗi cột A và B.');
        return null;
      }
      const pairs = cleanL.map((l) => {
        const found = correctPairs.find((p) => p.leftId === l.id);
        return {
          leftId: l.id,
          rightId:
            found && cleanR.some((r) => r.id === found.rightId)
              ? found.rightId
              : cleanR[0].id,
        };
      });
      return {
        matchingLeft: cleanL,
        matchingRight: cleanR,
        correctPairs: pairs,
      };
    }

    return {
      hotspotType,
      hotspotTarget,
      imageAlt: imageAlt.trim() || HOTSPOT_TYPE_LABELS[hotspotType],
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!prompt.trim()) {
      setError('Vui lòng nhập nội dung câu hỏi.');
      return;
    }
    const payload = buildPayload();
    if (!payload) return;

    setSaving(true);
    try {
      await onSave(
        {
          module,
          level,
          category,
          contentCode: contentCode.trim() || `${category}1`,
          topicOrder: Math.max(1, Math.round(Number(topicOrder) || 1)),
          topic: topic.trim() || 'Tổng hợp',
          type,
          prompt: prompt.trim(),
          instruction: instruction.trim() || undefined,
          difficulty,
          payload,
          explanation: explanation.trim(),
          tips: tips.trim() || undefined,
        },
        initialQuestion?.id
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể lưu câu hỏi.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="question-modal-title"
      className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
    >
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <h3
            id="question-modal-title"
            className="font-display text-lg font-semibold text-slate-900 dark:text-white"
          >
            {initialQuestion ? 'Chỉnh sửa Câu hỏi IC3' : 'Soạn Câu hỏi IC3 mới'}
          </h3>
          <button
            type="button"
            aria-label="Đóng trình soạn câu hỏi"
            disabled={saving}
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="overflow-y-auto p-6 space-y-5">
          {error && (
            <div
              role="alert"
              className="p-3 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-xs text-red-700 dark:text-red-300"
            >
              {error}
            </div>
          )}

          {/* Metadata grid */}
          {(() => {
            const moduleOptions: Array<{ code: string; level: string; title: string }> =
              availableModules.length > 0
                ? availableModules.map((m) => ({
                    code: m.code,
                    level: m.level,
                    title: m.title,
                  }))
                : Object.entries(MODULE_LABELS).map(([code, title]) => ({
                    code,
                    level:
                      code === 'computing_fundamentals'
                        ? 'LV1'
                        : code === 'key_applications'
                          ? 'LV2'
                          : 'LV3',
                    title,
                  }));

            const hasCurrentModule = moduleOptions.some((m) => m.code === module);
            if (!hasCurrentModule && module) {
              moduleOptions.push({ code: module, level, title: `${module} (${level})` });
            }

            const matchedCategories = availableCategories.filter(
              (c) => c.module === module
            );
            const categoryOptions: Array<{ code: string; title: string }> =
              matchedCategories.length > 0
                ? matchedCategories.map((c) => ({ code: c.code, title: c.title }))
                : Object.entries(CATEGORY_LABELS).map(([code, info]) => ({
                    code,
                    title: info.name,
                  }));

            if (
              category &&
              !categoryOptions.some(
                (c) => c.code.toUpperCase() === category.toUpperCase()
              )
            ) {
              categoryOptions.push({ code: category, title: `Nhóm ${category}` });
            }

            return (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                <div className="lg:col-span-2">
                  <label htmlFor="q-module" className="block text-xs font-medium mb-1">
                    Mô-đun IC3
                  </label>
                  <select
                    id="q-module"
                    value={module}
                    onChange={(e) => {
                      const m = e.target.value as IC3Module;
                      setModule(m);
                      const modObj = moduleOptions.find((x) => x.code === m);
                      if (modObj) {
                        setLevel(modObj.level);
                      } else if (m === 'computing_fundamentals') {
                        setLevel('LV1');
                      } else if (m === 'key_applications') {
                        setLevel('LV2');
                      } else if (m === 'living_online') {
                        setLevel('LV3');
                      }
                      const nextCats = availableCategories.filter((c) => c.module === m);
                      const nextCatCode =
                        nextCats.length > 0 &&
                        !nextCats.some(
                          (c) => c.code.toUpperCase() === category.toUpperCase()
                        )
                          ? nextCats[0].code
                          : category;
                      if (nextCatCode !== category) {
                        setCategory(nextCatCode);
                      }
                      const matching = availableParts.filter(
                        (p) => p.module === m && p.category === nextCatCode
                      );
                      if (matching.length > 0) {
                        if (!matching.some((p) => p.code === contentCode)) {
                          setContentCode(matching[0].code);
                        }
                      } else {
                        setContentCode(`${nextCatCode}1`);
                      }
                    }}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  >
                    {moduleOptions.map((m) => (
                      <option key={m.code} value={m.code}>
                        {m.title}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="q-type" className="block text-xs font-medium mb-1">
                    Dạng câu hỏi
                  </label>
                  <select
                    id="q-type"
                    value={type}
                    onChange={(e) => setType(e.target.value as QuestionType)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  >
                    {Object.entries(QUESTION_TYPE_LABELS).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="q-category" className="block text-xs font-medium mb-1">
                    Nhóm kiến thức
                  </label>
                  <select
                    id="q-category"
                    value={category}
                    onChange={(e) => {
                      const nextCat = e.target.value as KnowledgeCategory;
                      setCategory(nextCat);
                      const matching = availableParts.filter(
                        (p) => p.module === module && p.category === nextCat
                      );
                      if (matching.length > 0) {
                        setContentCode(matching[0].code);
                      } else {
                        setContentCode(`${nextCat}1`);
                      }
                    }}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  >
                    {categoryOptions.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.code} — {c.title}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="q-difficulty" className="block text-xs font-medium mb-1">
                    Độ khó
                  </label>
                  <select
                    id="q-difficulty"
                    value={difficulty}
                    onChange={(e) => setDifficulty(e.target.value as DifficultyLevel)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  >
                    <option value="easy">Cơ bản</option>
                    <option value="medium">Trung bình</option>
                    <option value="hard">Nâng cao</option>
                  </select>
                </div>
              </div>
            );
          })()}

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
            <div className="sm:col-span-3">
              <label htmlFor="q-content-code" className="block text-xs font-medium mb-1">
                Phần kiến thức
              </label>
              {(() => {
                const matchingParts = availableParts.filter(
                  (p) => p.module === module && p.category === category
                );
                if (matchingParts.length > 0) {
                  const hasCurrent = matchingParts.some(
                    (p) => p.code.toLowerCase() === contentCode.trim().toLowerCase()
                  );
                  return (
                    <select
                      id="q-content-code"
                      value={contentCode}
                      onChange={(e) => setContentCode(e.target.value)}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    >
                      {matchingParts.map((p) => (
                        <option key={p.id} value={p.code}>
                          {p.code} — {p.title}
                        </option>
                      ))}
                      {!hasCurrent && contentCode.trim() && (
                        <option value={contentCode}>{contentCode}</option>
                      )}
                    </select>
                  );
                }
                return (
                  <input
                    id="q-content-code"
                    type="text"
                    required
                    value={contentCode}
                    onChange={(e) => setContentCode(e.target.value)}
                    placeholder={`${category}1`}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                );
              })()}
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="q-topic-order" className="block text-xs font-medium mb-1">
                STT câu hỏi
              </label>
              <input
                id="q-topic-order"
                type="number"
                min={1}
                required
                value={topicOrder}
                onChange={(e) => setTopicOrder(Math.max(1, Number(e.target.value) || 1))}
                className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div className="sm:col-span-3">
              <label htmlFor="q-topic" className="block text-xs font-medium mb-1">
                Chủ đề kiến thức
              </label>
              <input
                id="q-topic"
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div className="sm:col-span-4">
              <label htmlFor="q-instruction" className="block text-xs font-medium mb-1">
                Hướng dẫn ngắn (tùy chọn)
              </label>
              <input
                id="q-instruction"
                type="text"
                placeholder="VD: Chọn TẤT CẢ đáp án đúng"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
          </div>

          <div>
            <label htmlFor="q-prompt" className="block text-xs font-medium mb-1">
              Nội dung câu hỏi
            </label>
            <textarea
              id="q-prompt"
              rows={2}
              required
              placeholder="Nhập đề bài hiển thị cho học sinh..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </div>

          {/* Specialized Form by QuestionType */}
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 space-y-3">
            {(type === 'single' || type === 'multiple') && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {type === 'single'
                      ? 'Các lựa chọn (chọn 1 đáp án đúng)'
                      : 'Các lựa chọn (tích tất cả đáp án đúng)'}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setOptions([
                        ...options,
                        { id: `opt_${options.length + 1}_${Date.now()}`, text: '' },
                      ])
                    }
                    className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-400 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" /> Thêm phương án
                  </button>
                </div>
                <div className="space-y-2">
                  {options.map((opt, idx) => {
                    const checked =
                      type === 'single'
                        ? correctOptionId === opt.id
                        : correctOptionIds.includes(opt.id);
                    return (
                      <div key={opt.id} className="flex items-center gap-2">
                        <input
                          type={type === 'single' ? 'radio' : 'checkbox'}
                          name="correct-option"
                          checked={checked}
                          aria-label={`Đánh dấu phương án ${idx + 1} là đúng`}
                          onChange={() => {
                            if (type === 'single') {
                              setCorrectOptionId(opt.id);
                            } else {
                              setCorrectOptionIds((prev) =>
                                prev.includes(opt.id)
                                  ? prev.filter((x) => x !== opt.id)
                                  : [...prev, opt.id]
                              );
                            }
                          }}
                        />
                        <input
                          type="text"
                          placeholder={`Phương án ${idx + 1}`}
                          value={opt.text}
                          onChange={(e) => {
                            const next = [...options];
                            next[idx] = { ...opt, text: e.target.value };
                            setOptions(next);
                          }}
                          className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                        />
                        {options.length > 2 && (
                          <button
                            type="button"
                            aria-label={`Xóa phương án ${idx + 1}`}
                            onClick={() =>
                              setOptions(options.filter((_, i) => i !== idx))
                            }
                            className="p-1.5 text-slate-400 hover:text-red-600 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {type === 'true_false' && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Danh sách ý phát biểu Đúng / Sai (học sinh phải đúng toàn bộ)
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setStatements([
                        ...statements,
                        { id: `st_${Date.now()}`, text: '', isTrue: true },
                      ])
                    }
                    className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-400 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" /> Thêm ý
                  </button>
                </div>
                <div className="space-y-2">
                  {statements.map((st, idx) => (
                    <div key={st.id} className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder={`Phát biểu ${idx + 1}`}
                        value={st.text}
                        onChange={(e) => {
                          const next = [...statements];
                          next[idx] = { ...st, text: e.target.value };
                          setStatements(next);
                        }}
                        className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const next = [...statements];
                          next[idx] = { ...st, isTrue: !st.isTrue };
                          setStatements(next);
                        }}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-lg border cursor-pointer w-20 ${
                          st.isTrue
                            ? 'border-emerald-600 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                            : 'border-red-600 bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300'
                        }`}
                      >
                        {st.isTrue ? 'Đúng' : 'Sai'}
                      </button>
                      {statements.length > 1 && (
                        <button
                          type="button"
                          aria-label={`Xóa ý ${idx + 1}`}
                          onClick={() =>
                            setStatements(statements.filter((_, i) => i !== idx))
                          }
                          className="p-1.5 text-slate-400 hover:text-red-600 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}

            {type === 'matching' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Cột A (1, 2, 3...) — Cột B (A, B, C...) & Ánh xạ cặp đúng
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const lid = `l_${Date.now()}`;
                      const rid = `r_${Date.now()}`;
                      setMatchingLeft([...matchingLeft, { id: lid, text: '' }]);
                      setMatchingRight([...matchingRight, { id: rid, text: '' }]);
                      setCorrectPairs([...correctPairs, { leftId: lid, rightId: rid }]);
                    }}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-400 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" /> Thêm cặp
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-slate-500">Cột A</div>
                    {matchingLeft.map((item, idx) => (
                      <div key={item.id} className="flex items-center gap-2">
                        <span className="font-mono text-xs w-5 text-slate-500">
                          {idx + 1}.
                        </span>
                        <input
                          type="text"
                          value={item.text}
                          placeholder={`Mục trái ${idx + 1}`}
                          onChange={(e) => {
                            const next = [...matchingLeft];
                            next[idx] = { ...item, text: e.target.value };
                            setMatchingLeft(next);
                          }}
                          className="flex-1 px-2.5 py-1.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                        />
                      </div>
                    ))}
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-slate-500">Cột B</div>
                    {matchingRight.map((item, idx) => (
                      <div key={item.id} className="flex items-center gap-2">
                        <span className="font-mono text-xs w-5 text-slate-500">
                          {String.fromCharCode(65 + idx)}.
                        </span>
                        <input
                          type="text"
                          value={item.text}
                          placeholder={`Mục phải ${String.fromCharCode(65 + idx)}`}
                          onChange={(e) => {
                            const next = [...matchingRight];
                            next[idx] = { ...item, text: e.target.value };
                            setMatchingRight(next);
                          }}
                          className="flex-1 px-2.5 py-1.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-1.5">
                  <div className="text-xs font-medium text-slate-600 dark:text-slate-400">
                    Đáp án ghép cặp đúng:
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {matchingLeft.map((left, idx) => {
                      const pair = correctPairs.find((p) => p.leftId === left.id);
                      return (
                        <div key={left.id} className="flex items-center gap-1.5 text-xs">
                          <span className="font-mono font-semibold">
                            {idx + 1} →
                          </span>
                          <select
                            aria-label={`Đáp án ghép cho mục ${idx + 1}`}
                            value={pair?.rightId ?? matchingRight[0]?.id ?? ''}
                            onChange={(e) => {
                              const rid = e.target.value;
                              setCorrectPairs((prev) => {
                                const without = prev.filter(
                                  (p) => p.leftId !== left.id
                                );
                                return [...without, { leftId: left.id, rightId: rid }];
                              });
                            }}
                            className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                          >
                            {matchingRight.map((r, rIdx) => (
                              <option key={r.id} value={r.id}>
                                {String.fromCharCode(65 + rIdx)}. {r.text || '(Trống)'}
                              </option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {type === 'hotspot' && (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label htmlFor="hs-template" className="block text-xs font-medium mb-1">
                      Mẫu giao diện Hotspot
                    </label>
                    <select
                      id="hs-template"
                      value={hotspotType}
                      onChange={(e) => setHotspotType(e.target.value as HotspotType)}
                      className="w-full px-3 py-1.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                    >
                      {Object.entries(HOTSPOT_TYPE_LABELS).map(([k, label]) => (
                        <option key={k} value={k}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="hs-label" className="block text-xs font-medium mb-1">
                      Nhãn vùng đáp án đúng
                    </label>
                    <input
                      id="hs-label"
                      type="text"
                      value={hotspotTarget.label}
                      onChange={(e) =>
                        setHotspotTarget({ ...hotspotTarget, label: e.target.value })
                      }
                      className="w-full px-3 py-1.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                    />
                  </div>
                  <div>
                    <label htmlFor="hs-alt" className="block text-xs font-medium mb-1">
                      Mô tả ảnh (Alt text)
                    </label>
                    <input
                      id="hs-alt"
                      type="text"
                      value={imageAlt}
                      onChange={(e) => setImageAlt(e.target.value)}
                      className="w-full px-3 py-1.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                    />
                  </div>
                </div>

                <HotspotCanvas
                  hotspotType={hotspotType}
                  target={hotspotTarget}
                  editable
                  onChangeTarget={setHotspotTarget}
                />
              </div>
            )}
          </div>

          {/* Explanation & Tips */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="q-explanation" className="block text-xs font-medium mb-1">
                Giải thích đáp án (lưu DB)
              </label>
              <textarea
                id="q-explanation"
                rows={2}
                value={explanation}
                onChange={(e) => setExplanation(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div>
              <label htmlFor="q-tips" className="block text-xs font-medium mb-1">
                Mẹo ghi nhớ (tùy chọn)
              </label>
              <textarea
                id="q-tips"
                rows={2}
                value={tips}
                onChange={(e) => setTips(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              disabled={saving}
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-5 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{saving ? 'Đang lưu & đồng bộ...' : 'Lưu Câu hỏi'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
