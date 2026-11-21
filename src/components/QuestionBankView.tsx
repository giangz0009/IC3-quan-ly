import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronRight,
  Database,
  DownloadCloud,
  Layers,
  ListOrdered,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import {
  CATEGORY_LABELS,
  MODULE_LABELS,
  QUESTION_TYPE_LABELS,
  type AdminDatabase,
  type IC3Level,
  type IC3Module,
  type IC3ModuleRecord,
  type KnowledgeCategory,
  type KnowledgeCategoryRecord,
  type KnowledgePart,
  type Question,
  type QuestionSet,
  type QuestionType,
} from '../types/ic3';
import { api } from '../utils/api';
import {
  buildReorderedPartUpdates,
  collectHotspotStoragePathsToDelete,
  formatQuestionOrderSummary,
  getNextTopicOrder,
  getObsoleteHotspotStoragePath,
  getPartQuestionsSorted,
  pickQuestionsBySelectedIds,
  sliceQuestionsByOrderRange,
  toggleSelectAllVisibleIds,
} from '../utils/ic3Rules';
import {
  deleteHotspotImagesFromSupabase,
  deleteKnowledgeCategoryOnSupabase,
  deleteKnowledgePartOnSupabase,
  deleteModuleOnSupabase,
  deleteQuestionAndSyncSetsOnSupabase,
  deleteQuestionsBatchAndSyncSetsOnSupabase,
  deleteQuestionSetOnSupabase,
  fetchQuestionBankFromSupabase,
  getQuestionBankSupabaseEnabled,
  isSupabaseConfigured,
  pushQuestionBankToSupabase,
  reorderQuestionsOnSupabase,
  setQuestionBankSupabaseEnabled,
  syncCategoryWithParentOnSupabase,
  syncPartWithParentsOnSupabase,
  syncQuestionWithParentsOnSupabase,
  upsertModuleOnSupabase,
  upsertQuestionSetOnSupabase,
} from '../utils/supabaseClient';
import { HotspotCanvas } from './HotspotCanvas';
import { QuestionEditorModal, type QuestionDefaultContext } from './QuestionEditorModal';

interface QuestionBankViewProps {
  db: Omit<AdminDatabase, 'teachers'>;
  onRefresh: () => Promise<void>;
  onNotify: (msg: string, isError?: boolean) => void;
  onOpenSupabase?: () => void;
}

function getDefaultLevelForModule(mod: IC3Module): IC3Level {
  if (mod === 'computing_fundamentals') return 'LV1';
  if (mod === 'key_applications') return 'LV2';
  if (mod === 'living_online') return 'LV3';
  return mod.toUpperCase();
}

export const QuestionBankView: React.FC<QuestionBankViewProps> = ({
  db,
  onRefresh,
  onNotify,
  onOpenSupabase,
}) => {
  const [subTab, setSubTab] = useState<'questions' | 'sets'>('questions');
  const [pullingSupabase, setPullingSupabase] = useState(false);
  const [pushingSupabase, setPushingSupabase] = useState(false);
  const supabaseReady = isSupabaseConfigured();
  const [liveSupabaseEnabled, setLiveSupabaseEnabled] = useState(() =>
    getQuestionBankSupabaseEnabled()
  );

  // 4-step drill-down state
  const [selectedModule, setSelectedModule] = useState<IC3Module | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<KnowledgeCategory | null>(null);
  const [selectedPartCode, setSelectedPartCode] = useState<string | null>(null);

  // Step 4 filters
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | QuestionType>('all');

  // Range-to-Set helper state
  const [rangeFrom, setRangeFrom] = useState<number>(1);
  const [rangeTo, setRangeTo] = useState<number>(1);

  // Step 4 multi-select state
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<string[]>([]);
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false);
  const [deletingBatchQuestions, setDeletingBatchQuestions] = useState(false);
  const selectAllCheckboxRef = useRef<HTMLInputElement | null>(null);

  // Add/Edit Module form state
  const [showModuleForm, setShowModuleForm] = useState(false);
  const [editingModuleRecord, setEditingModuleRecord] =
    useState<IC3ModuleRecord | null>(null);
  const [moduleForm, setModuleForm] = useState({
    level: '',
    code: '',
    title: '',
    description: '',
  });
  const [savingModule, setSavingModule] = useState(false);
  const [deletingModuleId, setDeletingModuleId] = useState<string | null>(null);

  // Add/Edit Knowledge Category form state
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [editingCategoryRecord, setEditingCategoryRecord] =
    useState<KnowledgeCategoryRecord | null>(null);
  const [categoryForm, setCategoryForm] = useState({
    code: '',
    title: '',
    description: '',
  });
  const [savingCategory, setSavingCategory] = useState(false);
  const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(null);

  // Add/Edit Part form state
  const [showAddPartForm, setShowAddPartForm] = useState(false);
  const [editingPartRecord, setEditingPartRecord] =
    useState<KnowledgePart | null>(null);
  const [newPartCode, setNewPartCode] = useState('');
  const [newPartTitle, setNewPartTitle] = useState('');
  const [newPartDesc, setNewPartDesc] = useState('');
  const [savingPart, setSavingPart] = useState(false);
  const [deletingPartId, setDeletingPartId] = useState<string | null>(null);

  // Question Modal state
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [showQuestionModal, setShowQuestionModal] = useState(false);
  const [deletingQuestionId, setDeletingQuestionId] = useState<string | null>(null);
  const [movingQuestionId, setMovingQuestionId] = useState<string | null>(null);

  // Question Set Modal state
  const [editingSet, setEditingSet] = useState<QuestionSet | null>(null);
  const [showSetModal, setShowSetModal] = useState(false);
  const [savingSet, setSavingSet] = useState(false);
  const [deletingSetId, setDeletingSetId] = useState<string | null>(null);
  const [setForm, setSetForm] = useState({
    title: '',
    description: '',
    level: 'LV1' as IC3Level,
    category: 'GM' as KnowledgeCategory,
    contentCode: 'GM1',
    questionIds: [] as string[],
  });

  const knowledgeParts = db.knowledgeParts ?? [];

  // Derive modules from db.modules merged with any orphan codes found in categories/parts/questions
  const allModules = useMemo(() => {
    const defined = [...(db.modules ?? [])].sort(
      (a, b) => a.orderIndex - b.orderIndex
    );
    const seenCodes = new Set(defined.map((m) => m.code));
    const extras: IC3ModuleRecord[] = [];

    for (const item of [
      ...(db.knowledgeCategories ?? []),
      ...knowledgeParts,
      ...db.questions,
    ]) {
      if (!seenCodes.has(item.module)) {
        seenCodes.add(item.module);
        const lv =
          'level' in item && item.level
            ? item.level
            : getDefaultLevelForModule(item.module);
        extras.push({
          id: `virtual_mod_${item.module}`,
          code: item.module,
          level: lv,
          title: MODULE_LABELS[item.module] || `${item.module} (${lv})`,
          description: 'Tạo tự động từ dữ liệu câu hỏi/nhóm hiện có.',
          orderIndex: defined.length + extras.length + 1,
        });
      }
    }

    return [...defined, ...extras];
  }, [db.modules, db.knowledgeCategories, knowledgeParts, db.questions]);

  function getLevelForModule(mod: IC3Module): IC3Level {
    const found = allModules.find((m) => m.code === mod);
    return found?.level ?? getDefaultLevelForModule(mod);
  }

  function getModuleTitle(mod: IC3Module): string {
    const found = allModules.find((m) => m.code === mod);
    return found?.title ?? MODULE_LABELS[mod] ?? mod;
  }

  // Derive Knowledge Categories for selected Module
  const currentModuleCategories = useMemo(() => {
    if (!selectedModule) return [];
    const defined = (db.knowledgeCategories ?? [])
      .filter((c) => c.module === selectedModule)
      .sort((a, b) => a.orderIndex - b.orderIndex);

    const seenCodes = new Set(defined.map((c) => c.code.trim().toUpperCase()));
    const extras: KnowledgeCategoryRecord[] = [];

    for (const item of [...knowledgeParts, ...db.questions]) {
      if (item.module !== selectedModule) continue;
      const code = item.category.trim().toUpperCase();
      if (code && !seenCodes.has(code)) {
        seenCodes.add(code);
        extras.push({
          id: `virtual_cat_${selectedModule}_${code}`,
          module: selectedModule,
          code,
          title: CATEGORY_LABELS[code]?.name || `Nhóm ${code}`,
          description:
            CATEGORY_LABELS[code]?.description ||
            'Tạo tự động từ dữ liệu phần/câu hỏi hiện có.',
          orderIndex: defined.length + extras.length + 1,
        });
      }
    }

    return [...defined, ...extras];
  }, [db.knowledgeCategories, knowledgeParts, db.questions, selectedModule]);

  // Derive parts for the currently selected (module, category), merging defined parts + any orphan codes in questions
  const currentCategoryParts = useMemo(() => {
    if (!selectedModule || !selectedCategory) return [];
    const defined = knowledgeParts
      .filter((p) => p.module === selectedModule && p.category === selectedCategory)
      .sort((a, b) => a.orderIndex - b.orderIndex);

    const seenCodes = new Set(defined.map((p) => p.code.trim().toLowerCase()));
    const extras: KnowledgePart[] = [];

    for (const q of db.questions) {
      if (q.module !== selectedModule || q.category !== selectedCategory) continue;
      const code = (q.contentCode || `${selectedCategory}1`).trim();
      if (!seenCodes.has(code.toLowerCase())) {
        seenCodes.add(code.toLowerCase());
        extras.push({
          id: `virtual_${selectedModule}_${selectedCategory}_${code}`,
          module: selectedModule,
          level: getLevelForModule(selectedModule),
          category: selectedCategory,
          code,
          title: `Chuyên đề ${code}`,
          description: 'Tạo tự động từ dữ liệu câu hỏi hiện có.',
          orderIndex: defined.length + extras.length + 1,
        });
      }
    }

    return [...defined, ...extras];
  }, [knowledgeParts, db.questions, selectedModule, selectedCategory, allModules]);

  const activePartMeta = useMemo(() => {
    if (!selectedPartCode) return null;
    return (
      currentCategoryParts.find(
        (p) => p.code.toLowerCase() === selectedPartCode.toLowerCase()
      ) ?? null
    );
  }, [currentCategoryParts, selectedPartCode]);

  // All questions for selected Part, sorted by topicOrder ascending
  const partQuestionsSorted = useMemo(() => {
    if (!selectedModule || !selectedCategory || !selectedPartCode) return [];
    return getPartQuestionsSorted(
      db.questions,
      selectedModule,
      selectedCategory,
      selectedPartCode
    );
  }, [db.questions, selectedModule, selectedCategory, selectedPartCode]);

  const filteredPartQuestions = useMemo(() => {
    const q = search.trim().toLowerCase();
    return partQuestionsSorted.filter((item) => {
      if (typeFilter !== 'all' && item.type !== typeFilter) return false;
      if (q) {
        const orderLabel = `câu ${item.topicOrder}`;
        const matchesText =
          item.prompt.toLowerCase().includes(q) ||
          item.topic.toLowerCase().includes(q) ||
          orderLabel.includes(q) ||
          String(item.topicOrder) === q;
        if (!matchesText) return false;
      }
      return true;
    });
  }, [partQuestionsSorted, search, typeFilter]);

  const hasActiveFilter = search.trim() !== '' || typeFilter !== 'all';

  const visibleQuestionIds = useMemo(
    () => filteredPartQuestions.map((q) => q.id),
    [filteredPartQuestions]
  );

  const activeSelectedQuestions = useMemo(
    () => pickQuestionsBySelectedIds(partQuestionsSorted, selectedQuestionIds),
    [partQuestionsSorted, selectedQuestionIds]
  );

  const allVisibleSelected =
    visibleQuestionIds.length > 0 &&
    visibleQuestionIds.every((id) => selectedQuestionIds.includes(id));

  const someVisibleSelected = visibleQuestionIds.some((id) =>
    selectedQuestionIds.includes(id)
  );

  useEffect(() => {
    if (selectAllCheckboxRef.current) {
      selectAllCheckboxRef.current.indeterminate =
        someVisibleSelected && !allVisibleSelected;
    }
  }, [someVisibleSelected, allVisibleSelected]);

  const defaultQuestionContext: QuestionDefaultContext | undefined = useMemo(() => {
    if (!selectedModule || !selectedCategory || !selectedPartCode) return undefined;
    return {
      module: selectedModule,
      level: getLevelForModule(selectedModule),
      category: selectedCategory,
      contentCode: selectedPartCode,
      topicOrder: getNextTopicOrder(
        db.questions,
        selectedModule,
        selectedCategory,
        selectedPartCode
      ),
    };
  }, [db.questions, selectedModule, selectedCategory, selectedPartCode, allModules]);

  function selectModule(mod: IC3Module) {
    setSelectedModule(mod);
    setSelectedCategory(null);
    setSelectedPartCode(null);
    setShowModuleForm(false);
    setShowCategoryForm(false);
    setShowAddPartForm(false);
    setEditingPartRecord(null);
    setSelectedQuestionIds([]);
    setConfirmBatchDelete(false);
    setSearch('');
    setTypeFilter('all');
  }

  function selectCategory(cat: KnowledgeCategory) {
    setSelectedCategory(cat);
    setSelectedPartCode(null);
    setShowCategoryForm(false);
    setShowAddPartForm(false);
    setEditingPartRecord(null);
    setSelectedQuestionIds([]);
    setConfirmBatchDelete(false);
    setSearch('');
    setTypeFilter('all');
  }

  function selectPart(code: string) {
    setSelectedPartCode(code);
    setShowAddPartForm(false);
    setEditingPartRecord(null);
    setSelectedQuestionIds([]);
    setConfirmBatchDelete(false);
    setSearch('');
    setTypeFilter('all');
    if (selectedModule && selectedCategory) {
      const sorted = getPartQuestionsSorted(
        db.questions,
        selectedModule,
        selectedCategory,
        code
      );
      setRangeFrom(sorted[0]?.topicOrder ?? 1);
      setRangeTo(sorted[sorted.length - 1]?.topicOrder ?? 1);
    }
  }

  function handleStepBack() {
    if (selectedPartCode) {
      setSelectedPartCode(null);
      setSelectedQuestionIds([]);
      setConfirmBatchDelete(false);
      setSearch('');
      setTypeFilter('all');
      return;
    }
    if (selectedCategory) {
      setSelectedCategory(null);
      setShowAddPartForm(false);
      setEditingPartRecord(null);
      return;
    }
    if (selectedModule) {
      setSelectedModule(null);
      setShowCategoryForm(false);
    }
  }

  async function handlePullFromSupabase() {
    setPullingSupabase(true);
    try {
      const pulled = await fetchQuestionBankFromSupabase();
      if (!pulled.ok) {
        onNotify(pulled.message, true);
        return;
      }
      if (
        pulled.modules.length === 0 &&
        pulled.knowledgeCategories.length === 0 &&
        pulled.knowledgeParts.length === 0 &&
        pulled.questions.length === 0 &&
        pulled.questionSets.length === 0
      ) {
        onNotify(
          'Không đọc được dòng dữ liệu nào từ Supabase (0 dòng). Nếu bạn đã thêm dữ liệu trên Supabase, hãy kiểm tra RLS Policy (cho phép anon SELECT) bằng cách chạy phần SQL phân quyền hoặc kiểm tra đúng Project URL.',
          true
        );
        return;
      }
      await api.importQuestionBankFromRemote({
        modules: pulled.modules,
        knowledgeCategories: pulled.knowledgeCategories,
        knowledgeParts: pulled.knowledgeParts,
        questions: pulled.questions,
        questionSets: pulled.questionSets,
      });
      setQuestionBankSupabaseEnabled(true);
      setLiveSupabaseEnabled(true);
      if (
        selectedModule &&
        !pulled.modules.some((m) => m.code === selectedModule) &&
        !pulled.questions.some((q) => q.module === selectedModule)
      ) {
        setSelectedModule(null);
        setSelectedCategory(null);
        setSelectedPartCode(null);
      }
      await onRefresh();
      onNotify(pulled.message);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Không thể lấy CSDL Ngân hàng Câu hỏi từ Supabase.',
        true
      );
    } finally {
      setPullingSupabase(false);
    }
  }

  async function handlePushToSupabase() {
    setPushingSupabase(true);
    try {
      const res = await pushQuestionBankToSupabase({
        modules: db.modules,
        knowledgeCategories: db.knowledgeCategories,
        knowledgeParts: db.knowledgeParts,
        questions: db.questions,
        questionSets: db.questionSets,
      });
      if (res.ok) {
        setQuestionBankSupabaseEnabled(true);
        setLiveSupabaseEnabled(true);
      }
      onNotify(res.message, !res.ok);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Không thể đẩy Ngân hàng Câu hỏi lên Supabase.',
        true
      );
    } finally {
      setPushingSupabase(false);
    }
  }

  function handleToggleLiveSupabase(next: boolean) {
    setQuestionBankSupabaseEnabled(next);
    setLiveSupabaseEnabled(next);
    onNotify(
      next
        ? 'Đã bật tự động đồng bộ 2 chiều Ngân hàng Câu hỏi với Supabase.'
        : 'Đã tạm tắt tự động đồng bộ Supabase cho Ngân hàng Câu hỏi.'
    );
  }

  function openNewModuleForm() {
    const nextNum = allModules.length + 1;
    setEditingModuleRecord(null);
    setModuleForm({
      level: `LV${nextNum}`,
      code: `module_lv${nextNum}`,
      title: '',
      description: '',
    });
    setShowModuleForm(true);
  }

  function openEditModuleForm(mod: IC3ModuleRecord) {
    setEditingModuleRecord(mod);
    setModuleForm({
      level: mod.level,
      code: mod.code,
      title: mod.title,
      description: mod.description,
    });
    setShowModuleForm(true);
  }

  async function handleSaveModule(e: React.FormEvent) {
    e.preventDefault();
    const level = moduleForm.level.trim().toUpperCase();
    const title = moduleForm.title.trim();
    const code = (moduleForm.code.trim() || level)
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '');
    if (!level || !title || !code) {
      onNotify('Vui lòng nhập đầy đủ Level, mã và tên Mô-đun.', true);
      return;
    }
    setSavingModule(true);
    try {
      const saved = editingModuleRecord
        ? await api.updateModule(editingModuleRecord.id, {
            level,
            title,
            description: moduleForm.description.trim(),
          })
        : await api.createModule({
            level,
            code,
            title,
            description: moduleForm.description.trim(),
          });
      let syncErr: string | null = null;
      if (getQuestionBankSupabaseEnabled()) {
        try {
          await upsertModuleOnSupabase(saved);
        } catch (e2) {
          syncErr = e2 instanceof Error ? e2.message : 'Lỗi đồng bộ Supabase';
        }
      }
      setShowModuleForm(false);
      setEditingModuleRecord(null);
      await onRefresh();
      if (syncErr) {
        onNotify(
          `Đã lưu cục bộ mô-đun ${level}, nhưng lỗi đồng bộ Supabase: ${syncErr}`,
          true
        );
      } else {
        onNotify(
          editingModuleRecord
            ? `Đã cập nhật Mô-đun ${level}.`
            : `Đã thêm Mô-đun ${level} mới.`
        );
      }
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Không thể lưu Mô-đun.',
        true
      );
    } finally {
      setSavingModule(false);
    }
  }

  async function handleDeleteModule(mod: IC3ModuleRecord) {
    setDeletingModuleId(mod.id);
    try {
      await api.deleteModule(mod.id);
      let syncErr: string | null = null;
      if (getQuestionBankSupabaseEnabled()) {
        try {
          await deleteModuleOnSupabase(mod);
        } catch (e2) {
          syncErr = e2 instanceof Error ? e2.message : 'Lỗi đồng bộ Supabase';
        }
      }
      await onRefresh();
      if (syncErr) {
        onNotify(
          `Đã xóa cục bộ mô-đun ${mod.level}, nhưng lỗi đồng bộ Supabase: ${syncErr}`,
          true
        );
      } else {
        onNotify(`Đã xóa Mô-đun ${mod.level}.`);
      }
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Không thể xóa Mô-đun này.',
        true
      );
    } finally {
      setDeletingModuleId(null);
    }
  }

  function openNewCategoryForm() {
    setEditingCategoryRecord(null);
    setCategoryForm({
      code: '',
      title: '',
      description: '',
    });
    setShowCategoryForm(true);
  }

  function openEditCategoryForm(cat: KnowledgeCategoryRecord) {
    setEditingCategoryRecord(cat);
    setCategoryForm({
      code: cat.code,
      title: cat.title,
      description: cat.description,
    });
    setShowCategoryForm(true);
  }

  async function handleSaveCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedModule) return;
    const code = categoryForm.code.trim().toUpperCase();
    const title = categoryForm.title.trim();
    if (!code || !title) {
      onNotify('Vui lòng nhập mã nhóm (VD: GM, OT, TH) và tên nhóm kiến thức.', true);
      return;
    }
    setSavingCategory(true);
    try {
      const saved = editingCategoryRecord
        ? await api.updateKnowledgeCategory(editingCategoryRecord.id, {
            title,
            description: categoryForm.description.trim(),
          })
        : await api.createKnowledgeCategory({
            module: selectedModule,
            code,
            title,
            description: categoryForm.description.trim(),
          });
      let syncErr: string | null = null;
      if (getQuestionBankSupabaseEnabled()) {
        try {
          const parentMod = allModules.find((m) => m.code === saved.module);
          await syncCategoryWithParentOnSupabase(parentMod, saved);
        } catch (e2) {
          syncErr = e2 instanceof Error ? e2.message : 'Lỗi đồng bộ Supabase';
        }
      }
      setShowCategoryForm(false);
      setEditingCategoryRecord(null);
      await onRefresh();
      if (syncErr) {
        onNotify(
          `Đã lưu cục bộ nhóm ${code}, nhưng lỗi đồng bộ Supabase: ${syncErr}`,
          true
        );
      } else {
        onNotify(
          editingCategoryRecord
            ? `Đã cập nhật nhóm kiến thức ${code}.`
            : `Đã thêm nhóm kiến thức ${code}.`
        );
      }
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Không thể lưu nhóm kiến thức.',
        true
      );
    } finally {
      setSavingCategory(false);
    }
  }

  async function handleDeleteCategory(cat: KnowledgeCategoryRecord) {
    setDeletingCategoryId(cat.id);
    try {
      await api.deleteKnowledgeCategory(cat.id);
      let syncErr: string | null = null;
      if (getQuestionBankSupabaseEnabled()) {
        try {
          await deleteKnowledgeCategoryOnSupabase(cat);
        } catch (e2) {
          syncErr = e2 instanceof Error ? e2.message : 'Lỗi đồng bộ Supabase';
        }
      }
      await onRefresh();
      if (syncErr) {
        onNotify(
          `Đã xóa cục bộ nhóm ${cat.code}, nhưng lỗi đồng bộ Supabase: ${syncErr}`,
          true
        );
      } else {
        onNotify(`Đã xóa nhóm kiến thức ${cat.code}.`);
      }
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Không thể xóa nhóm kiến thức này.',
        true
      );
    } finally {
      setDeletingCategoryId(null);
    }
  }

  function openNewPartForm() {
    if (!selectedCategory) return;
    const nextIdx = currentCategoryParts.length + 1;
    setEditingPartRecord(null);
    setNewPartCode(`${selectedCategory}${nextIdx}`);
    setNewPartTitle('');
    setNewPartDesc('');
    setShowAddPartForm(true);
  }

  function openEditPartForm(part: KnowledgePart) {
    setEditingPartRecord(part);
    setNewPartCode(part.code);
    setNewPartTitle(part.title);
    setNewPartDesc(part.description);
    setShowAddPartForm(true);
  }

  async function handleSavePart(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedModule || !selectedCategory) return;
    const code = newPartCode.trim().toUpperCase();
    const title = newPartTitle.trim();
    if (!code || !title) {
      onNotify('Vui lòng nhập mã phần (VD: GM3) và tên phần kiến thức.', true);
      return;
    }
    setSavingPart(true);
    try {
      const saved = editingPartRecord
        ? await api.updateKnowledgePart(editingPartRecord.id, {
            title,
            description: newPartDesc.trim(),
          })
        : await api.createKnowledgePart({
            module: selectedModule,
            level: getLevelForModule(selectedModule),
            category: selectedCategory,
            code,
            title,
            description: newPartDesc.trim(),
          });
      let syncErr: string | null = null;
      if (getQuestionBankSupabaseEnabled()) {
        try {
          const parentMod = allModules.find((m) => m.code === saved.module);
          const parentCat = (db.knowledgeCategories ?? []).find(
            (c) =>
              c.module === saved.module &&
              c.code.toUpperCase() === saved.category.toUpperCase()
          );
          await syncPartWithParentsOnSupabase(parentMod, parentCat, saved);
        } catch (e2) {
          syncErr = e2 instanceof Error ? e2.message : 'Lỗi đồng bộ Supabase';
        }
      }
      const wasEditing = Boolean(editingPartRecord);
      setNewPartCode('');
      setNewPartTitle('');
      setNewPartDesc('');
      setEditingPartRecord(null);
      setShowAddPartForm(false);
      await onRefresh();
      if (syncErr) {
        onNotify(`Đã lưu cục bộ phần ${code}, nhưng lỗi đồng bộ Supabase: ${syncErr}`, true);
      } else {
        onNotify(
          wasEditing
            ? `Đã cập nhật phần kiến thức ${code}.`
            : `Đã thêm phần kiến thức ${code}.`
        );
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Không thể lưu phần kiến thức.', true);
    } finally {
      setSavingPart(false);
    }
  }

  async function handleDeletePart(part: KnowledgePart) {
    setDeletingPartId(part.id);
    try {
      await api.deleteKnowledgePart(part.id);
      let syncErr: string | null = null;
      if (getQuestionBankSupabaseEnabled()) {
        try {
          await deleteKnowledgePartOnSupabase(part);
        } catch (e2) {
          syncErr = e2 instanceof Error ? e2.message : 'Lỗi đồng bộ Supabase';
        }
      }
      await onRefresh();
      if (syncErr) {
        onNotify(`Đã xóa cục bộ phần ${part.code}, nhưng lỗi đồng bộ Supabase: ${syncErr}`, true);
      } else {
        onNotify(`Đã xóa phần ${part.code}.`);
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Không thể xóa phần này.', true);
    } finally {
      setDeletingPartId(null);
    }
  }

  async function handleSaveQuestion(
    payload: Omit<Question, 'id' | 'createdAt' | 'updatedAt'>,
    existingId?: string
  ) {
    const prevQuestion = existingId
      ? db.questions.find((item) => item.id === existingId)
      : undefined;
    const prevImageUrl =
      prevQuestion && 'imageUrl' in prevQuestion.payload
        ? prevQuestion.payload.imageUrl
        : undefined;
    const nextImageUrl =
      'imageUrl' in payload.payload ? payload.payload.imageUrl : undefined;

    const saved = existingId
      ? await api.updateQuestion(existingId, payload)
      : await api.createQuestion(payload);

    let syncErr: string | null = null;
    if (getQuestionBankSupabaseEnabled()) {
      try {
        const freshDb = await api.bootstrap();
        await syncQuestionWithParentsOnSupabase(freshDb, saved);
      } catch (e2) {
        syncErr = e2 instanceof Error ? e2.message : 'Lỗi đồng bộ Supabase';
      }
    }

    const otherQuestions = db.questions.filter((item) => item.id !== saved.id);
    const obsoleteStoragePath = getObsoleteHotspotStoragePath(
      prevImageUrl,
      nextImageUrl,
      otherQuestions
    );
    let storageCleanupErr: string | null = null;
    if (obsoleteStoragePath && isSupabaseConfigured()) {
      const removed = await deleteHotspotImagesFromSupabase([obsoleteStoragePath]);
      if (!removed.ok) {
        storageCleanupErr = removed.message || 'Không xóa được ảnh cũ khỏi Storage';
      }
    }

    await onRefresh();
    if (syncErr || storageCleanupErr) {
      const details = [syncErr, storageCleanupErr].filter(Boolean).join('; ');
      onNotify(`Đã lưu câu hỏi nhưng gặp lỗi đồng bộ Supabase: ${details}`, true);
    } else {
      onNotify(existingId ? 'Đã cập nhật câu hỏi.' : 'Đã thêm câu hỏi mới vào phần kiến thức.');
    }
  }

  async function handleDeleteQuestion(q: Question) {
    setDeletingQuestionId(q.id);
    try {
      const remainingQuestions = db.questions.filter((item) => item.id !== q.id);
      const storagePathsToDelete = collectHotspotStoragePathsToDelete(
        [q],
        remainingQuestions
      );
      const updatedAffectedSets = db.questionSets
        .filter((s) => s.questionIds.includes(q.id))
        .map((s) => ({
          ...s,
          questionIds: s.questionIds.filter((id) => id !== q.id),
          updatedAt: new Date().toISOString(),
        }));
      await api.deleteQuestion(q.id);
      let syncErr: string | null = null;
      if (getQuestionBankSupabaseEnabled()) {
        try {
          await deleteQuestionAndSyncSetsOnSupabase(q.id, updatedAffectedSets);
        } catch (e2) {
          syncErr = e2 instanceof Error ? e2.message : 'Lỗi đồng bộ Supabase';
        }
      }
      let storageCleanupErr: string | null = null;
      if (storagePathsToDelete.length > 0 && isSupabaseConfigured()) {
        const removed = await deleteHotspotImagesFromSupabase(storagePathsToDelete);
        if (!removed.ok) {
          storageCleanupErr = removed.message || 'Không xóa được ảnh khỏi Storage';
        }
      }
      setSelectedQuestionIds((prev) => prev.filter((id) => id !== q.id));
      await onRefresh();
      if (syncErr || storageCleanupErr) {
        const details = [syncErr, storageCleanupErr].filter(Boolean).join('; ');
        onNotify(`Đã xóa cục bộ Câu ${q.topicOrder}, nhưng lỗi đồng bộ Supabase: ${details}`, true);
      } else {
        onNotify(`Đã xóa Câu ${q.topicOrder}.`);
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Lỗi xóa câu hỏi.', true);
    } finally {
      setDeletingQuestionId(null);
    }
  }

  function toggleQuestionSelection(qId: string) {
    setSelectedQuestionIds((prev) =>
      prev.includes(qId) ? prev.filter((id) => id !== qId) : [...prev, qId]
    );
    setConfirmBatchDelete(false);
  }

  function handleToggleSelectAllVisible() {
    setSelectedQuestionIds((prev) =>
      toggleSelectAllVisibleIds(prev, visibleQuestionIds)
    );
    setConfirmBatchDelete(false);
  }

  function handleClearQuestionSelection() {
    setSelectedQuestionIds([]);
    setConfirmBatchDelete(false);
  }

  async function handleBatchDeleteSelectedQuestions() {
    const ids = activeSelectedQuestions.map((q) => q.id);
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const remainingQuestions = db.questions.filter((item) => !idSet.has(item.id));
    const storagePathsToDelete = collectHotspotStoragePathsToDelete(
      activeSelectedQuestions,
      remainingQuestions
    );
    setDeletingBatchQuestions(true);
    try {
      const updatedAffectedSets = db.questionSets
        .filter((s) => s.questionIds.some((id) => idSet.has(id)))
        .map((s) => ({
          ...s,
          questionIds: s.questionIds.filter((id) => !idSet.has(id)),
          updatedAt: new Date().toISOString(),
        }));
      await api.batchDeleteQuestions(ids);
      let syncErr: string | null = null;
      if (getQuestionBankSupabaseEnabled()) {
        try {
          await deleteQuestionsBatchAndSyncSetsOnSupabase(ids, updatedAffectedSets);
        } catch (e2) {
          syncErr = e2 instanceof Error ? e2.message : 'Lỗi đồng bộ Supabase';
        }
      }
      let storageCleanupErr: string | null = null;
      if (storagePathsToDelete.length > 0 && isSupabaseConfigured()) {
        const removed = await deleteHotspotImagesFromSupabase(storagePathsToDelete);
        if (!removed.ok) {
          storageCleanupErr = removed.message || 'Không xóa được ảnh khỏi Storage';
        }
      }
      setSelectedQuestionIds([]);
      setConfirmBatchDelete(false);
      await onRefresh();
      if (syncErr || storageCleanupErr) {
        const details = [syncErr, storageCleanupErr].filter(Boolean).join('; ');
        onNotify(
          `Đã xóa cục bộ ${ids.length} câu hỏi, nhưng lỗi đồng bộ Supabase: ${details}`,
          true
        );
      } else {
        onNotify(`Đã xóa ${ids.length} câu hỏi đã chọn.`);
      }
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Lỗi xóa hàng loạt câu hỏi.',
        true
      );
    } finally {
      setDeletingBatchQuestions(false);
    }
  }

  function handleCreateSetFromSelected() {
    if (!selectedModule || !selectedCategory || !selectedPartCode) return;
    if (activeSelectedQuestions.length === 0) {
      onNotify('Vui lòng chọn ít nhất 1 câu hỏi để tạo bộ đề.', true);
      return;
    }
    const orderSummary = formatQuestionOrderSummary(activeSelectedQuestions);
    setEditingSet(null);
    setSetForm({
      title: `${getLevelForModule(selectedModule)} · ${selectedPartCode} (${activeSelectedQuestions.length} câu chọn lọc)`,
      description: `Trích từ ${selectedPartCode}: ${orderSummary}.`,
      level: getLevelForModule(selectedModule),
      category: selectedCategory,
      contentCode: selectedPartCode,
      questionIds: activeSelectedQuestions.map((item) => item.id),
    });
    setShowSetModal(true);
  }

  async function handleMoveQuestion(q: Question, direction: -1 | 1) {
    if (!selectedModule || !selectedCategory || !selectedPartCode) return;
    const updates = buildReorderedPartUpdates(
      db.questions,
      selectedModule,
      selectedCategory,
      selectedPartCode,
      q.id,
      direction
    );
    setMovingQuestionId(q.id);
    try {
      await api.reorderQuestions(updates);
      let syncErr: string | null = null;
      if (getQuestionBankSupabaseEnabled()) {
        try {
          await reorderQuestionsOnSupabase(updates);
        } catch (e2) {
          syncErr = e2 instanceof Error ? e2.message : 'Lỗi đồng bộ Supabase';
        }
      }
      await onRefresh();
      if (syncErr) {
        onNotify(`Đã cập nhật thứ tự cục bộ, nhưng lỗi đồng bộ Supabase: ${syncErr}`, true);
      } else {
        onNotify('Đã cập nhật số thứ tự câu hỏi trong phần.');
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Không thể đổi thứ tự câu hỏi.', true);
    } finally {
      setMovingQuestionId(null);
    }
  }

  function handleCreateSetFromRange() {
    if (!selectedModule || !selectedCategory || !selectedPartCode) return;
    const sliced = sliceQuestionsByOrderRange(
      db.questions,
      selectedModule,
      selectedCategory,
      selectedPartCode,
      rangeFrom,
      rangeTo
    );
    if (sliced.length === 0) {
      onNotify(
        `Không có câu hỏi nào trong khoảng từ Câu ${Math.min(rangeFrom, rangeTo)} đến Câu ${Math.max(rangeFrom, rangeTo)}.`,
        true
      );
      return;
    }
    const minO = Math.min(rangeFrom, rangeTo);
    const maxO = Math.max(rangeFrom, rangeTo);
    setEditingSet(null);
    setSetForm({
      title: `${getLevelForModule(selectedModule)} · ${selectedPartCode} (Câu ${minO}–${maxO})`,
      description: `Trích từ ${selectedPartCode}: ${activePartMeta?.title ?? ''} (từ câu ${minO} đến câu ${maxO}).`,
      level: getLevelForModule(selectedModule),
      category: selectedCategory,
      contentCode: selectedPartCode,
      questionIds: sliced.map((item) => item.id),
    });
    setShowSetModal(true);
  }

  function openNewSet() {
    setEditingSet(null);
    setSetForm({
      title: '',
      description: '',
      level: selectedModule ? getLevelForModule(selectedModule) : 'LV1',
      category: selectedCategory ?? 'GM',
      contentCode: selectedPartCode ?? 'GM1',
      questionIds: [],
    });
    setShowSetModal(true);
  }

  function openEditSet(set: QuestionSet) {
    setEditingSet(set);
    setSetForm({
      title: set.title,
      description: set.description,
      level: set.level ?? 'LV1',
      category: set.category ?? 'GM',
      contentCode: set.contentCode ?? '',
      questionIds: set.questionIds,
    });
    setShowSetModal(true);
  }

  async function handleSaveSet(e: React.FormEvent) {
    e.preventDefault();
    setSavingSet(true);
    try {
      const saved = editingSet
        ? await api.updateQuestionSet(editingSet.id, setForm)
        : await api.createQuestionSet(setForm);
      let syncErr: string | null = null;
      if (getQuestionBankSupabaseEnabled()) {
        try {
          await upsertQuestionSetOnSupabase(saved);
        } catch (e2) {
          syncErr = e2 instanceof Error ? e2.message : 'Lỗi đồng bộ Supabase';
        }
      }
      await onRefresh();
      setShowSetModal(false);
      if (syncErr) {
        onNotify(
          `Đã lưu cục bộ bộ đề "${setForm.title}", nhưng lỗi đồng bộ Supabase: ${syncErr}`,
          true
        );
      } else {
        onNotify(
          editingSet
            ? `Đã cập nhật bộ đề "${setForm.title}".`
            : `Đã tạo bộ đề "${setForm.title}".`
        );
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Lỗi lưu bộ đề.', true);
    } finally {
      setSavingSet(false);
    }
  }

  async function handleDeleteSet(set: QuestionSet) {
    setDeletingSetId(set.id);
    try {
      await api.deleteQuestionSet(set.id);
      let syncErr: string | null = null;
      if (getQuestionBankSupabaseEnabled()) {
        try {
          await deleteQuestionSetOnSupabase(set.id);
        } catch (e2) {
          syncErr = e2 instanceof Error ? e2.message : 'Lỗi đồng bộ Supabase';
        }
      }
      await onRefresh();
      if (syncErr) {
        onNotify(
          `Đã xóa cục bộ bộ đề "${set.title}", nhưng lỗi đồng bộ Supabase: ${syncErr}`,
          true
        );
      } else {
        onNotify(`Đã xóa bộ đề "${set.title}".`);
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Lỗi xóa bộ đề.', true);
    } finally {
      setDeletingSetId(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Sub-navigation & Context Primary Action */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-slate-200/70 dark:bg-slate-800/80">
          <button
            type="button"
            onClick={() => setSubTab('questions')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              subTab === 'questions'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Ngân hàng Câu hỏi ({db.questions.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('sets')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              subTab === 'sets'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Bộ đề Luyện & Thi đấu ({db.questionSets.length})
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {supabaseReady ? (
            <>
              <label className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 whitespace-nowrap shrink-0 cursor-pointer">
                <input
                  type="checkbox"
                  checked={liveSupabaseEnabled}
                  onChange={(e) => handleToggleLiveSupabase(e.target.checked)}
                />
                <span>Tự động đồng bộ Supabase</span>
              </label>
              <button
                type="button"
                disabled={pullingSupabase || pushingSupabase}
                onClick={handlePullFromSupabase}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {pullingSupabase ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <DownloadCloud className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                )}
                <span>{pullingSupabase ? 'Đang lấy...' : 'Lấy từ Supabase'}</span>
              </button>
              <button
                type="button"
                disabled={pushingSupabase || pullingSupabase}
                onClick={handlePushToSupabase}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {pushingSupabase ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600 dark:text-blue-400" />
                ) : (
                  <UploadCloud className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                )}
                <span>{pushingSupabase ? 'Đang đẩy...' : 'Đẩy lên Supabase'}</span>
              </button>
            </>
          ) : (
            onOpenSupabase && (
              <button
                type="button"
                onClick={onOpenSupabase}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Database className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                <span>Kết nối CSDL Supabase</span>
              </button>
            )
          )}

          {subTab === 'questions' ? (
            <>
              {!selectedModule && (
                <button
                  type="button"
                  onClick={() => {
                    if (showModuleForm && !editingModuleRecord) {
                      setShowModuleForm(false);
                    } else {
                      openNewModuleForm();
                    }
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Thêm Mô-đun (Level)</span>
                </button>
              )}
              {selectedModule && !selectedCategory && (
                <button
                  type="button"
                  onClick={() => {
                    if (showCategoryForm && !editingCategoryRecord) {
                      setShowCategoryForm(false);
                    } else {
                      openNewCategoryForm();
                    }
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Thêm Nhóm kiến thức</span>
                </button>
              )}
              {selectedModule && selectedCategory && !selectedPartCode && (
                <button
                  type="button"
                  onClick={() => {
                    if (showAddPartForm && !editingPartRecord) {
                      setShowAddPartForm(false);
                    } else {
                      openNewPartForm();
                    }
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Thêm Phần {selectedCategory} mới</span>
                </button>
              )}
              {selectedModule && selectedCategory && selectedPartCode && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingQuestion(null);
                    setShowQuestionModal(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Soạn Câu hỏi mới</span>
                </button>
              )}
            </>
          ) : (
            <button
              type="button"
              onClick={openNewSet}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Tạo Bộ đề mới</span>
            </button>
          )}
        </div>
      </div>

      {subTab === 'questions' ? (
        <div className="space-y-5">
          {/* Hierarchical Breadcrumb Bar */}
          {selectedModule && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
              <nav
                aria-label="Đường dẫn phân cấp ngân hàng câu hỏi"
                className="flex flex-wrap items-center gap-1.5 text-xs"
              >
                <button
                  type="button"
                  onClick={() => {
                    setSelectedModule(null);
                    setSelectedCategory(null);
                    setSelectedPartCode(null);
                    setShowCategoryForm(false);
                    setShowAddPartForm(false);
                  }}
                  className="font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                >
                  Tất cả Mô-đun
                </button>
                <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCategory(null);
                    setSelectedPartCode(null);
                    setShowCategoryForm(false);
                    setShowAddPartForm(false);
                  }}
                  className={`cursor-pointer ${
                    selectedCategory
                      ? 'font-medium text-blue-600 dark:text-blue-400 hover:underline'
                      : 'font-semibold text-slate-900 dark:text-white'
                  }`}
                >
                  {getModuleTitle(selectedModule)}
                </button>
                {selectedCategory && (
                  <>
                    <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedPartCode(null);
                        setShowAddPartForm(false);
                      }}
                      className={`cursor-pointer ${
                        selectedPartCode
                          ? 'font-medium text-blue-600 dark:text-blue-400 hover:underline'
                          : 'font-semibold text-slate-900 dark:text-white'
                      }`}
                    >
                      Nhóm {selectedCategory}
                    </button>
                  </>
                )}
                {selectedPartCode && (
                  <>
                    <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="font-mono font-semibold text-slate-900 dark:text-white">
                      {selectedPartCode}
                      {activePartMeta ? ` — ${activePartMeta.title}` : ''}
                    </span>
                  </>
                )}
              </nav>

              <button
                type="button"
                onClick={handleStepBack}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Quay lại</span>
              </button>
            </div>
          )}

          {/* STEP 1: Modules (Levels) */}
          {!selectedModule && (
            <section aria-label="Chọn Mô-đun IC3" className="space-y-4">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                  Bước 1: Chọn hoặc Quản lý Mô-đun (Level) IC3
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Chọn một Mô-đun để xem danh sách nhóm kiến thức và từng phần bài tập, hoặc thêm/chỉnh sửa Mô-đun mới trong CSDL.
                </p>
              </div>

              {showModuleForm && (
                <form
                  onSubmit={handleSaveModule}
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                      {editingModuleRecord
                        ? `Chỉnh sửa Mô-đun ${editingModuleRecord.level}`
                        : 'Thêm Mô-đun (Level) mới'}
                    </h3>
                    <button
                      type="button"
                      onClick={() => {
                        setShowModuleForm(false);
                        setEditingModuleRecord(null);
                      }}
                      aria-label="Đóng biểu mẫu mô-đun"
                      className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                    <div className="sm:col-span-2">
                      <label htmlFor="mod-level" className="block text-xs font-medium mb-1">
                        Level
                      </label>
                      <input
                        id="mod-level"
                        type="text"
                        required
                        placeholder="VD: LV4"
                        value={moduleForm.level}
                        onChange={(e) => {
                          const lv = e.target.value;
                          setModuleForm((prev) => ({
                            ...prev,
                            level: lv,
                            code:
                              !editingModuleRecord &&
                              (!prev.code || prev.code.startsWith('module_'))
                                ? `module_${lv.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_')}`
                                : prev.code,
                          }));
                        }}
                        className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <label htmlFor="mod-code" className="block text-xs font-medium mb-1">
                        Mã CSDL (code)
                      </label>
                      <input
                        id="mod-code"
                        type="text"
                        required
                        disabled={Boolean(editingModuleRecord)}
                        placeholder="VD: digital_citizenship"
                        value={moduleForm.code}
                        onChange={(e) =>
                          setModuleForm({ ...moduleForm, code: e.target.value })
                        }
                        className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 disabled:opacity-60"
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <label htmlFor="mod-title" className="block text-xs font-medium mb-1">
                        Tên Mô-đun
                      </label>
                      <input
                        id="mod-title"
                        type="text"
                        required
                        placeholder="VD: Trí tuệ nhân tạo (LV4)"
                        value={moduleForm.title}
                        onChange={(e) =>
                          setModuleForm({ ...moduleForm, title: e.target.value })
                        }
                        className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                      />
                    </div>
                    <div className="sm:col-span-4">
                      <label htmlFor="mod-desc" className="block text-xs font-medium mb-1">
                        Mô tả ngắn (tùy chọn)
                      </label>
                      <input
                        id="mod-desc"
                        type="text"
                        placeholder="Phạm vi kiến thức của Mô-đun..."
                        value={moduleForm.description}
                        onChange={(e) =>
                          setModuleForm({ ...moduleForm, description: e.target.value })
                        }
                        className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      disabled={savingModule}
                      onClick={() => {
                        setShowModuleForm(false);
                        setEditingModuleRecord(null);
                      }}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-50 cursor-pointer"
                    >
                      Hủy
                    </button>
                    <button
                      type="submit"
                      disabled={savingModule}
                      className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                    >
                      {savingModule && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      <span>
                        {savingModule
                          ? 'Đang lưu & đồng bộ...'
                          : editingModuleRecord
                            ? 'Cập nhật Mô-đun'
                            : 'Lưu Mô-đun mới'}
                      </span>
                    </button>
                  </div>
                </form>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {allModules.map((item) => {
                  const modQuestions = db.questions.filter((q) => q.module === item.code);
                  const modParts = knowledgeParts.filter((p) => p.module === item.code);
                  const modCats = (db.knowledgeCategories ?? []).filter(
                    (c) => c.module === item.code
                  );
                  const isVirtual = item.id.startsWith('virtual_mod_');
                  const canDelete =
                    !isVirtual &&
                    modCats.length === 0 &&
                    modParts.length === 0 &&
                    modQuestions.length === 0;

                  const catCodesForSummary = Array.from(
                    new Set([
                      ...modCats.map((c) => c.code),
                      ...modParts.map((p) => p.category),
                      ...modQuestions.map((q) => q.category),
                    ])
                  );

                  return (
                    <article
                      key={item.code}
                      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-blue-500 dark:hover:border-blue-500 rounded-xl flex flex-col justify-between transition-colors group"
                    >
                      <button
                        type="button"
                        onClick={() => selectModule(item.code)}
                        className="w-full flex-1 text-left p-5 space-y-2 cursor-pointer rounded-t-xl"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs font-bold text-blue-600 dark:text-blue-400">
                            {item.level}
                          </span>
                          <span className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                            {catCodesForSummary.length} nhóm · {modParts.length} phần ·{' '}
                            {modQuestions.length} câu
                          </span>
                        </div>
                        <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                          {item.title}
                        </h3>
                        <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                          {item.description || 'Chưa có mô tả cho mô-đun này.'}
                        </p>
                        <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums pt-1">
                          {catCodesForSummary.length > 0
                            ? catCodesForSummary
                                .map(
                                  (code) =>
                                    `${code} (${modQuestions.filter((q) => q.category === code).length})`
                                )
                                .join(' · ')
                            : 'Chưa có nhóm kiến thức'}
                        </div>
                      </button>

                      <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-1.5">
                          {!isVirtual && (
                            <button
                              type="button"
                              aria-label={`Sửa mô-đun ${item.level}`}
                              onClick={() => openEditModuleForm(item)}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                            >
                              <Pencil className="w-3 h-3" />
                              <span>Sửa</span>
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              aria-label={`Xóa mô-đun ${item.level}`}
                              disabled={deletingModuleId === item.id}
                              onClick={() => handleDeleteModule(item)}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                            >
                              {deletingModuleId === item.id ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Trash2 className="w-3 h-3" />
                              )}
                              <span>{deletingModuleId === item.id ? 'Đang xóa...' : 'Xóa'}</span>
                            </button>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => selectModule(item.code)}
                          className="inline-flex items-center gap-1 font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer ml-auto"
                        >
                          <span>Chọn nhóm</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          )}

          {/* STEP 2: Knowledge Categories (GM, OT, custom...) of selected Module */}
          {selectedModule && !selectedCategory && (
            <section aria-label="Chọn Nhóm kiến thức" className="space-y-4">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                  Bước 2: Chọn hoặc Quản lý Nhóm kiến thức — {getModuleTitle(selectedModule)}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Chọn nhóm kiến thức để mở danh sách các phần tương ứng, hoặc thêm/sửa nhóm mới cho Mô-đun này.
                </p>
              </div>

              {showCategoryForm && (
                <form
                  onSubmit={handleSaveCategory}
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                      {editingCategoryRecord
                        ? `Chỉnh sửa Nhóm ${editingCategoryRecord.code}`
                        : `Thêm Nhóm kiến thức vào ${getLevelForModule(selectedModule)}`}
                    </h3>
                    <button
                      type="button"
                      onClick={() => {
                        setShowCategoryForm(false);
                        setEditingCategoryRecord(null);
                      }}
                      aria-label="Đóng biểu mẫu nhóm kiến thức"
                      className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                    <div className="sm:col-span-3">
                      <label htmlFor="cat-code" className="block text-xs font-medium mb-1">
                        Mã nhóm
                      </label>
                      <input
                        id="cat-code"
                        type="text"
                        required
                        disabled={Boolean(editingCategoryRecord)}
                        placeholder="VD: TH, BT..."
                        value={categoryForm.code}
                        onChange={(e) =>
                          setCategoryForm({ ...categoryForm, code: e.target.value })
                        }
                        className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 disabled:opacity-60"
                      />
                    </div>
                    <div className="sm:col-span-4">
                      <label htmlFor="cat-title" className="block text-xs font-medium mb-1">
                        Tên nhóm kiến thức
                      </label>
                      <input
                        id="cat-title"
                        type="text"
                        required
                        placeholder="VD: Nhóm TH — Thực hành chuyên sâu"
                        value={categoryForm.title}
                        onChange={(e) =>
                          setCategoryForm({ ...categoryForm, title: e.target.value })
                        }
                        className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                      />
                    </div>
                    <div className="sm:col-span-5">
                      <label htmlFor="cat-desc" className="block text-xs font-medium mb-1">
                        Mô tả ngắn (tùy chọn)
                      </label>
                      <input
                        id="cat-desc"
                        type="text"
                        placeholder="Nội dung trọng tâm của nhóm kiến thức..."
                        value={categoryForm.description}
                        onChange={(e) =>
                          setCategoryForm({
                            ...categoryForm,
                            description: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      disabled={savingCategory}
                      onClick={() => {
                        setShowCategoryForm(false);
                        setEditingCategoryRecord(null);
                      }}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-50 cursor-pointer"
                    >
                      Hủy
                    </button>
                    <button
                      type="submit"
                      disabled={savingCategory}
                      className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                    >
                      {savingCategory && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      <span>
                        {savingCategory
                          ? 'Đang lưu & đồng bộ...'
                          : editingCategoryRecord
                            ? 'Cập nhật Nhóm'
                            : 'Lưu Nhóm mới'}
                      </span>
                    </button>
                  </div>
                </form>
              )}

              {currentModuleCategories.length === 0 ? (
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-10 text-center space-y-3">
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    Mô-đun {getLevelForModule(selectedModule)} hiện chưa có nhóm kiến thức nào.
                  </p>
                  <button
                    type="button"
                    onClick={openNewCategoryForm}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Thêm Nhóm kiến thức đầu tiên</span>
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {currentModuleCategories.map((cat) => {
                    const catParts = knowledgeParts
                      .filter(
                        (p) =>
                          p.module === selectedModule &&
                          p.category.toUpperCase() === cat.code.toUpperCase()
                      )
                      .sort((a, b) => a.orderIndex - b.orderIndex);
                    const catQuestions = db.questions.filter(
                      (q) =>
                        q.module === selectedModule &&
                        q.category.toUpperCase() === cat.code.toUpperCase()
                    );
                    const partCodes = Array.from(
                      new Set([
                        ...catParts.map((p) => p.code),
                        ...catQuestions.map((q) => q.contentCode).filter(Boolean),
                      ])
                    );
                    const isVirtual = cat.id.startsWith('virtual_cat_');
                    const canDelete =
                      !isVirtual && partCodes.length === 0 && catQuestions.length === 0;

                    return (
                      <article
                        key={cat.code}
                        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-blue-500 dark:hover:border-blue-500 rounded-xl flex flex-col justify-between transition-colors group"
                      >
                        <button
                          type="button"
                          onClick={() => selectCategory(cat.code)}
                          className="w-full flex-1 text-left p-5 space-y-2 cursor-pointer rounded-t-xl"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-xs font-bold text-blue-600 dark:text-blue-400">
                              {getLevelForModule(selectedModule)} · {cat.code}
                            </span>
                            <span className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                              {partCodes.length} phần · {catQuestions.length} câu hỏi
                            </span>
                          </div>
                          <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                            {cat.title}
                          </h3>
                          <p className="text-xs text-slate-600 dark:text-slate-400">
                            {cat.description || 'Chưa có mô tả cho nhóm kiến thức này.'}
                          </p>
                          <div className="text-xs text-slate-500 dark:text-slate-400 pt-1">
                            Các phần hiện có:{' '}
                            <span className="font-mono font-medium text-slate-700 dark:text-slate-300">
                              {partCodes.length > 0 ? partCodes.join(', ') : 'Chưa có phần nào'}
                            </span>
                          </div>
                        </button>

                        <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 text-xs">
                          <div className="flex items-center gap-1.5">
                            {!isVirtual && (
                              <button
                                type="button"
                                aria-label={`Sửa nhóm ${cat.code}`}
                                onClick={() => openEditCategoryForm(cat)}
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                              >
                                <Pencil className="w-3 h-3" />
                                <span>Sửa</span>
                              </button>
                            )}
                            {canDelete && (
                              <button
                                type="button"
                                aria-label={`Xóa nhóm ${cat.code}`}
                                disabled={deletingCategoryId === cat.id}
                                onClick={() => handleDeleteCategory(cat)}
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                              >
                                {deletingCategoryId === cat.id ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <Trash2 className="w-3 h-3" />
                                )}
                                <span>{deletingCategoryId === cat.id ? 'Đang xóa...' : 'Xóa'}</span>
                              </button>
                            )}
                            {isVirtual && (
                              <span className="inline-flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                                <Layers className="w-3.5 h-3.5" />
                                <span>Danh sách phần {cat.code}</span>
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => selectCategory(cat.code)}
                            className="inline-flex items-center gap-1 font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer ml-auto"
                          >
                            <span>Mở nhóm {cat.code}</span>
                            <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* STEP 3: Parts inside selected Category (e.g. GM1, GM2 / OT1, OT2, OT3...) */}
          {selectedModule && selectedCategory && !selectedPartCode && (
            <section aria-label="Chọn Phần của nhóm kiến thức" className="space-y-4">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                  Bước 3: Các phần của nhóm {selectedCategory} — {getModuleTitle(selectedModule)}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Chọn một phần kiến thức (VD: {selectedCategory}1, {selectedCategory}2...) để quản lý ngân hàng câu hỏi và đánh số thứ tự câu.
                </p>
              </div>

              {showAddPartForm && (
                <form
                  onSubmit={handleSavePart}
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                      {editingPartRecord
                        ? `Chỉnh sửa Phần ${editingPartRecord.code}`
                        : `Thêm Phần kiến thức vào ${getLevelForModule(selectedModule)} · ${selectedCategory}`}
                    </h3>
                    <button
                      type="button"
                      onClick={() => {
                        setShowAddPartForm(false);
                        setEditingPartRecord(null);
                      }}
                      aria-label="Đóng biểu mẫu phần kiến thức"
                      className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                    <div className="sm:col-span-3">
                      <label htmlFor="new-part-code" className="block text-xs font-medium mb-1">
                        Mã phần
                      </label>
                      <input
                        id="new-part-code"
                        type="text"
                        required
                        disabled={Boolean(editingPartRecord)}
                        placeholder={`${selectedCategory}${currentCategoryParts.length + 1}`}
                        value={newPartCode}
                        onChange={(e) => setNewPartCode(e.target.value)}
                        className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 disabled:opacity-60"
                      />
                    </div>
                    <div className="sm:col-span-4">
                      <label htmlFor="new-part-title" className="block text-xs font-medium mb-1">
                        Tên phần kiến thức
                      </label>
                      <input
                        id="new-part-title"
                        type="text"
                        required
                        placeholder="VD: Bảng tính & Biểu đồ nâng cao"
                        value={newPartTitle}
                        onChange={(e) => setNewPartTitle(e.target.value)}
                        className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                      />
                    </div>
                    <div className="sm:col-span-5">
                      <label htmlFor="new-part-desc" className="block text-xs font-medium mb-1">
                        Mô tả ngắn (tùy chọn)
                      </label>
                      <input
                        id="new-part-desc"
                        type="text"
                        placeholder="Nội dung trọng tâm của phần..."
                        value={newPartDesc}
                        onChange={(e) => setNewPartDesc(e.target.value)}
                        className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      disabled={savingPart}
                      onClick={() => {
                        setShowAddPartForm(false);
                        setEditingPartRecord(null);
                      }}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-50 cursor-pointer"
                    >
                      Hủy
                    </button>
                    <button
                      type="submit"
                      disabled={savingPart}
                      className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                    >
                      {savingPart && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      <span>
                        {savingPart
                          ? 'Đang lưu & đồng bộ...'
                          : editingPartRecord
                            ? 'Cập nhật Phần'
                            : 'Lưu Phần mới'}
                      </span>
                    </button>
                  </div>
                </form>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {currentCategoryParts.map((part) => {
                  const qs = getPartQuestionsSorted(
                    db.questions,
                    selectedModule,
                    selectedCategory,
                    part.code
                  );
                  const isVirtual = part.id.startsWith('virtual_');
                  const minOrder = qs[0]?.topicOrder;
                  const maxOrder = qs[qs.length - 1]?.topicOrder;

                  return (
                    <article
                      key={part.id}
                      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-blue-500 dark:hover:border-blue-500 rounded-xl transition-colors group flex flex-col justify-between"
                    >
                      <button
                        type="button"
                        onClick={() => selectPart(part.code)}
                        className="w-full flex-1 text-left p-5 space-y-2 cursor-pointer rounded-t-xl"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-sm font-bold text-blue-600 dark:text-blue-400">
                            {part.code}
                          </span>
                          <span className="font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                            {qs.length} câu hỏi
                          </span>
                        </div>
                        <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                          {part.title}
                        </h3>
                        <p className="text-xs text-slate-600 dark:text-slate-400">
                          {part.description || 'Chưa có mô tả cho phần kiến thức này.'}
                        </p>
                        <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums pt-1">
                          {qs.length > 0
                            ? `Thứ tự câu: Câu ${minOrder} – Câu ${maxOrder}`
                            : 'Chưa có câu hỏi nào'}
                        </div>
                      </button>

                      <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-1.5">
                          {!isVirtual && (
                            <button
                              type="button"
                              aria-label={`Sửa phần ${part.code}`}
                              onClick={() => openEditPartForm(part)}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                            >
                              <Pencil className="w-3 h-3" />
                              <span>Sửa</span>
                            </button>
                          )}
                          {!isVirtual && qs.length === 0 && (
                            <button
                              type="button"
                              aria-label={`Xóa phần ${part.code}`}
                              disabled={deletingPartId === part.id}
                              onClick={() => handleDeletePart(part)}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                            >
                              {deletingPartId === part.id ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Trash2 className="w-3 h-3" />
                              )}
                              <span>{deletingPartId === part.id ? 'Đang xóa...' : 'Xóa'}</span>
                            </button>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => selectPart(part.code)}
                          className="inline-flex items-center gap-1 font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer ml-auto"
                        >
                          <span>Mở câu hỏi</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          )}

          {/* STEP 4: Question Bank for selected Part with Sequential Order (topicOrder) */}
          {selectedModule && selectedCategory && selectedPartCode && (
            <section aria-label="Danh sách câu hỏi của phần kiến thức" className="space-y-4">
              {/* Part Summary + Range-to-Set Action */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                    {getLevelForModule(selectedModule)} · Nhóm {selectedCategory} · Phần{' '}
                    <span className="font-semibold text-blue-600 dark:text-blue-400">
                      {selectedPartCode}
                    </span>
                    {' · '}
                    <span className="tabular-nums">
                      {partQuestionsSorted.length} câu hỏi
                    </span>
                  </div>
                  <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                    {activePartMeta?.title ?? `Ngân hàng câu hỏi ${selectedPartCode}`}
                  </h2>
                </div>

                {partQuestionsSorted.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 pt-2 lg:pt-0 border-t lg:border-t-0 border-slate-100 dark:border-slate-800">
                    <span className="inline-flex items-center gap-1 text-xs text-slate-600 dark:text-slate-400">
                      <ListOrdered className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                      <span>Tạo bộ đề:</span>
                    </span>
                    <label htmlFor="range-from" className="text-xs text-slate-500">
                      Từ câu
                    </label>
                    <input
                      id="range-from"
                      type="number"
                      min={1}
                      value={rangeFrom}
                      onChange={(e) => setRangeFrom(Math.max(1, Number(e.target.value) || 1))}
                      className="w-16 px-2 py-1 text-xs font-mono tabular-nums rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                    />
                    <label htmlFor="range-to" className="text-xs text-slate-500">
                      đến câu
                    </label>
                    <input
                      id="range-to"
                      type="number"
                      min={1}
                      value={rangeTo}
                      onChange={(e) => setRangeTo(Math.max(1, Number(e.target.value) || 1))}
                      className="w-16 px-2 py-1 text-xs font-mono tabular-nums rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                    />
                    <button
                      type="button"
                      onClick={handleCreateSetFromRange}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-950 cursor-pointer whitespace-nowrap"
                    >
                      Tạo Bộ đề theo khoảng
                    </button>
                  </div>
                )}
              </div>

              {/* Filter Bar inside Part */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-12 gap-3">
                <div className="sm:col-span-8 relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Tìm nội dung, chủ đề hoặc số thứ tự (VD: Câu 1)..."
                    aria-label="Tìm câu hỏi trong phần"
                    className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                  />
                </div>

                <select
                  aria-label="Lọc theo dạng câu hỏi"
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value as 'all' | QuestionType)}
                  className="sm:col-span-4 px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
                >
                  <option value="all">Tất cả 5 dạng câu hỏi</option>
                  {Object.entries(QUESTION_TYPE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>

              {/* Bulk Selection & Actions Bar */}
              {(filteredPartQuestions.length > 0 || activeSelectedQuestions.length > 0) && (
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-100 cursor-pointer select-none">
                      <input
                        ref={selectAllCheckboxRef}
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={handleToggleSelectAllVisible}
                        disabled={filteredPartQuestions.length === 0}
                        className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-blue-600 cursor-pointer"
                      />
                      <span>
                        {hasActiveFilter
                          ? `Chọn tất cả đang hiển thị (${filteredPartQuestions.length})`
                          : `Chọn tất cả (${filteredPartQuestions.length} câu)`}
                      </span>
                    </label>

                    {activeSelectedQuestions.length > 0 && (
                      <>
                        <span className="text-xs font-mono tabular-nums font-semibold text-blue-600 dark:text-blue-400">
                          Đã chọn {activeSelectedQuestions.length} câu
                        </span>
                        <button
                          type="button"
                          onClick={handleClearQuestionSelection}
                          className="text-xs font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 underline cursor-pointer"
                        >
                          Bỏ chọn
                        </button>
                      </>
                    )}
                  </div>

                  {activeSelectedQuestions.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={handleCreateSetFromSelected}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-950 cursor-pointer whitespace-nowrap"
                      >
                        <ListOrdered className="w-3.5 h-3.5" />
                        <span>Tạo Bộ đề ({activeSelectedQuestions.length} câu)</span>
                      </button>

                      {!confirmBatchDelete ? (
                        <button
                          type="button"
                          onClick={() => setConfirmBatchDelete(true)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-950/70 cursor-pointer whitespace-nowrap"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Xóa {activeSelectedQuestions.length} câu đã chọn</span>
                        </button>
                      ) : (
                        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/50">
                          <span className="text-xs font-medium text-red-700 dark:text-red-300">
                            Xác nhận xóa {activeSelectedQuestions.length} câu?
                          </span>
                          <button
                            type="button"
                            disabled={deletingBatchQuestions}
                            onClick={handleBatchDeleteSelectedQuestions}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                          >
                            {deletingBatchQuestions && <Loader2 className="w-3 h-3 animate-spin" />}
                            <span>{deletingBatchQuestions ? 'Đang xóa...' : 'Xác nhận xóa'}</span>
                          </button>
                          <button
                            type="button"
                            disabled={deletingBatchQuestions}
                            onClick={() => setConfirmBatchDelete(false)}
                            className="px-2 py-1 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 cursor-pointer"
                          >
                            Hủy
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Ordered Question List */}
              <div className="space-y-4">
                {filteredPartQuestions.map((q, idx) => {
                  const isSelected = selectedQuestionIds.includes(q.id);
                  return (
                    <article
                      key={q.id}
                      className={`rounded-xl p-5 space-y-3 border transition-colors ${
                        isSelected
                          ? 'bg-blue-50/40 dark:bg-blue-950/20 border-blue-500 dark:border-blue-500'
                          : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="flex items-start gap-3 max-w-3xl">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleQuestionSelection(q.id)}
                            aria-label={`Chọn Câu ${q.topicOrder}: ${q.prompt}`}
                            className="mt-1 h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-blue-600 cursor-pointer shrink-0"
                          />
                          <div className="space-y-1.5">
                            <div className="text-xs text-slate-500 dark:text-slate-400">
                              <span className="font-mono font-bold text-blue-600 dark:text-blue-400 tabular-nums">
                                Câu {q.topicOrder}
                              </span>
                              {' · '}
                              <span className="font-mono">{q.contentCode}</span>
                              {' · '}
                              <span>{q.level}</span>
                              {' · '}
                              <span>{q.topic}</span>
                              {' · '}
                              <span>{QUESTION_TYPE_LABELS[q.type]}</span>
                            </div>
                            <h3 className="text-sm sm:text-base font-semibold text-slate-900 dark:text-slate-100">
                              {q.prompt}
                            </h3>
                          </div>
                        </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {!hasActiveFilter && partQuestionsSorted.length > 1 && (
                          <>
                            <button
                              type="button"
                              aria-label={`Đưa Câu ${q.topicOrder} lên trước`}
                              disabled={idx === 0 || movingQuestionId !== null || deletingQuestionId === q.id}
                              onClick={() => handleMoveQuestion(q, -1)}
                              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
                            >
                              {movingQuestionId === q.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <ArrowUp className="w-3.5 h-3.5" />
                              )}
                            </button>
                            <button
                              type="button"
                              aria-label={`Đưa Câu ${q.topicOrder} xuống sau`}
                              disabled={
                                idx === filteredPartQuestions.length - 1 ||
                                movingQuestionId !== null ||
                                deletingQuestionId === q.id
                              }
                              onClick={() => handleMoveQuestion(q, 1)}
                              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
                            >
                              {movingQuestionId === q.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <ArrowDown className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          disabled={deletingQuestionId === q.id}
                          onClick={() => {
                            setEditingQuestion(q);
                            setShowQuestionModal(true);
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          <span>Sửa</span>
                        </button>
                        <button
                          type="button"
                          aria-label={`Xóa câu hỏi ${q.id}`}
                          disabled={deletingQuestionId === q.id || deletingBatchQuestions}
                          onClick={() => handleDeleteQuestion(q)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                        >
                          {deletingQuestionId === q.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5" />
                          )}
                          <span>{deletingQuestionId === q.id ? 'Đang xóa...' : 'Xóa'}</span>
                        </button>
                      </div>
                    </div>

                    {/* Compact Answer Summary */}
                    <div className="text-xs text-slate-600 dark:text-slate-300 pt-2 border-t border-slate-100 dark:border-slate-800">
                      {q.type === 'single' && 'correctOptionId' in q.payload && (
                        <div>
                          Đáp án đúng:{' '}
                          <strong className="text-emerald-700 dark:text-emerald-400">
                            {
                              q.payload.options.find(
                                (o) =>
                                  o.id ===
                                  (q.payload as { correctOptionId: string }).correctOptionId
                              )?.text
                            }
                          </strong>
                        </div>
                      )}
                      {q.type === 'multiple' && 'correctOptionIds' in q.payload && (
                        <div>
                          Đáp án đúng ({q.payload.correctOptionIds.length}):{' '}
                          <strong className="text-emerald-700 dark:text-emerald-400">
                            {q.payload.options
                              .filter((o) =>
                                (
                                  q.payload as { correctOptionIds: string[] }
                                ).correctOptionIds.includes(o.id)
                              )
                              .map((o) => o.text)
                              .join(' | ')}
                          </strong>
                        </div>
                      )}
                      {q.type === 'true_false' && 'statements' in q.payload && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                          {q.payload.statements.map((s) => (
                            <div key={s.id}>
                              <span
                                className={`font-semibold ${
                                  s.isTrue
                                    ? 'text-emerald-700 dark:text-emerald-400'
                                    : 'text-red-600 dark:text-red-400'
                                }`}
                              >
                                [{s.isTrue ? 'Đúng' : 'Sai'}]
                              </span>{' '}
                              {s.text}
                            </div>
                          ))}
                        </div>
                      )}
                      {q.type === 'matching' && 'correctPairs' in q.payload && (
                        <div className="flex flex-wrap gap-x-4 gap-y-1">
                          {q.payload.correctPairs.map((p) => {
                            const mp = q.payload as {
                              matchingLeft: Array<{ id: string; text: string }>;
                              matchingRight: Array<{ id: string; text: string }>;
                            };
                            const left = mp.matchingLeft.find((l) => l.id === p.leftId);
                            const right = mp.matchingRight.find((r) => r.id === p.rightId);
                            return (
                              <span key={p.leftId}>
                                <strong>{left?.text}</strong> → {right?.text}
                              </span>
                            );
                          })}
                        </div>
                      )}
                      {q.type === 'hotspot' && 'hotspotTarget' in q.payload && (
                        <div className="mt-2 max-w-2xl">
                          <HotspotCanvas
                            imageUrl={q.payload.imageUrl}
                            imageAlt={q.payload.imageAlt}
                            hotspotType={q.payload.hotspotType}
                            target={q.payload.hotspotTarget}
                          />
                        </div>
                      )}
                    </div>
                  </article>
                  );
                })}

                {filteredPartQuestions.length === 0 && (
                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-10 text-center space-y-3">
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      {partQuestionsSorted.length === 0
                        ? `Phần ${selectedPartCode} hiện chưa có câu hỏi nào.`
                        : 'Không có câu hỏi nào phù hợp bộ lọc trong phần này.'}
                    </p>
                    {partQuestionsSorted.length === 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingQuestion(null);
                          setShowQuestionModal(true);
                        }}
                        className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Soạn Câu 1 cho {selectedPartCode}</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      ) : (
        /* Question Sets Grid */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {db.questionSets.map((set) => (
            <article
              key={set.id}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col justify-between gap-4"
            >
              <div className="space-y-1.5">
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {set.level || 'Tổng hợp'} · {set.category || 'GM/OT'} ·{' '}
                  {set.contentCode || 'Bộ đề'} ·{' '}
                  <span className="font-mono tabular-nums">
                    {set.questionIds.length} câu hỏi
                  </span>
                </div>
                <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                  {set.title}
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  {set.description || 'Không có mô tả.'}
                </p>
              </div>
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  disabled={deletingSetId === set.id}
                  onClick={() => openEditSet(set)}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
                >
                  Chỉnh sửa Bộ đề
                </button>
                <button
                  type="button"
                  disabled={deletingSetId === set.id}
                  onClick={() => handleDeleteSet(set)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {deletingSetId === set.id && <Loader2 className="w-3 h-3 animate-spin" />}
                  <span>{deletingSetId === set.id ? 'Đang xóa...' : 'Xóa'}</span>
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {showQuestionModal && (
        <QuestionEditorModal
          initialQuestion={editingQuestion}
          defaultContext={defaultQuestionContext}
          availableModules={allModules}
          availableCategories={db.knowledgeCategories ?? []}
          availableParts={knowledgeParts}
          onClose={() => setShowQuestionModal(false)}
          onSave={handleSaveQuestion}
        />
      )}

      {showSetModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="set-modal-title"
          className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
        >
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
              <h3
                id="set-modal-title"
                className="font-display text-lg font-semibold text-slate-900 dark:text-white"
              >
                {editingSet ? 'Chỉnh sửa Bộ đề' : 'Tạo Bộ đề mới'}
              </h3>
              <button
                type="button"
                aria-label="Đóng"
                disabled={savingSet}
                onClick={() => setShowSetModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveSet} className="overflow-y-auto p-6 space-y-4">
              <div>
                <label htmlFor="set-title" className="block text-xs font-medium mb-1">
                  Tên bộ đề
                </label>
                <input
                  id="set-title"
                  type="text"
                  required
                  value={setForm.title}
                  onChange={(e) => setSetForm({ ...setForm, title: e.target.value })}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label htmlFor="set-level" className="block text-xs font-medium mb-1">
                    Cấp độ
                  </label>
                  <select
                    id="set-level"
                    value={setForm.level}
                    onChange={(e) =>
                      setSetForm({ ...setForm, level: e.target.value as IC3Level })
                    }
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  >
                    {Array.from(
                      new Set([
                        ...allModules.map((m) => m.level),
                        setForm.level,
                      ].filter(Boolean))
                    ).map((lv) => (
                      <option key={lv} value={lv}>
                        {lv}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="set-cat" className="block text-xs font-medium mb-1">
                    Nhóm
                  </label>
                  <select
                    id="set-cat"
                    value={setForm.category}
                    onChange={(e) =>
                      setSetForm({
                        ...setForm,
                        category: e.target.value as KnowledgeCategory,
                      })
                    }
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  >
                    {Array.from(
                      new Set([
                        'GM',
                        'OT',
                        ...(db.knowledgeCategories ?? []).map((c) => c.code),
                        setForm.category,
                      ].filter(Boolean))
                    ).map((catCode) => (
                      <option key={catCode} value={catCode}>
                        {catCode}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="set-code" className="block text-xs font-medium mb-1">
                    Mã chuyên đề
                  </label>
                  <input
                    id="set-code"
                    type="text"
                    value={setForm.contentCode}
                    onChange={(e) =>
                      setSetForm({ ...setForm, contentCode: e.target.value })
                    }
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="set-desc" className="block text-xs font-medium mb-1">
                  Mô tả ngắn
                </label>
                <input
                  id="set-desc"
                  type="text"
                  value={setForm.description}
                  onChange={(e) =>
                    setSetForm({ ...setForm, description: e.target.value })
                  }
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <div className="text-xs font-medium mb-2">
                  Chọn câu hỏi trong bộ đề ({setForm.questionIds.length} câu đã chọn):
                </div>
                <div className="max-h-56 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-lg divide-y divide-slate-100 dark:divide-slate-800">
                  {db.questions.map((q) => {
                    const checked = setForm.questionIds.includes(q.id);
                    return (
                      <label
                        key={q.id}
                        className="flex items-start gap-2.5 p-2.5 text-xs hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            setSetForm((prev) => ({
                              ...prev,
                              questionIds: checked
                                ? prev.questionIds.filter((id) => id !== q.id)
                                : [...prev.questionIds, q.id],
                            }));
                          }}
                          className="mt-0.5"
                        />
                        <div className="min-w-0">
                          <div className="font-medium text-slate-900 dark:text-slate-100">
                            <span className="font-mono text-blue-600 dark:text-blue-400">
                              {q.contentCode} · Câu {q.topicOrder}:
                            </span>{' '}
                            {q.prompt}
                          </div>
                          <div className="text-slate-500">
                            {q.level} · {q.category} · {QUESTION_TYPE_LABELS[q.type]} · {q.topic}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={savingSet}
                  onClick={() => setShowSetModal(false)}
                  className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-50 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={savingSet}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {savingSet && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{savingSet ? 'Đang lưu & đồng bộ...' : 'Lưu Bộ đề'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
