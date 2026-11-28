import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CheckCircle2,
  ChevronRight,
  Download,
  FileJson,
  FileSpreadsheet,
  Layers,
  ListOrdered,
  Loader2,
  PauseCircle,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
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
  buildQuestionBankExportPackage,
  buildReorderedPartUpdates,
  canBatchToggleKnowledgeParts,
  filterKnowledgeCategoriesByReadiness,
  filterKnowledgePartsByReadiness,
  formatQuestionBankToCsv,
  formatQuestionOrderSummary,
  getNextTopicOrder,
  getPartQuestionsSorted,
  isKnowledgeCategoryEnabled,
  isKnowledgePartEnabled,
  parseQuestionBankImportInput,
  pickQuestionsBySelectedIds,
  sliceQuestionsByOrderRange,
  summarizeKnowledgeCategoryReadiness,
  summarizeKnowledgePartReadiness,
  toggleSelectAllVisibleIds,
} from '../utils/ic3Rules';
import {
  buildQuestionBankExcelBuffer,
  parseQuestionBankExcelSheet,
  readExcelWorkbookBuffer,
  type ParsedExcelWorkbookData,
} from '../utils/ic3Excel';
import { HotspotCanvas } from './HotspotCanvas';
import { QuestionEditorModal, type QuestionDefaultContext } from './QuestionEditorModal';
import { CardGridSkeleton, ListSkeleton } from './TableSkeleton';

interface QuestionBankViewProps {
  db: Omit<AdminDatabase, 'teachers'>;
  canEdit?: boolean;
  loading?: boolean;
  onRefresh: () => Promise<void>;
  onNotify: (msg: string, isError?: boolean) => void;
}

const SHOW_QUESTION_BANK_IMPORT_EXPORT: boolean = false;

function getDefaultLevelForModule(mod: IC3Module): IC3Level {
  if (mod === 'computing_fundamentals') return 'LV1';
  if (mod === 'key_applications') return 'LV2';
  if (mod === 'living_online') return 'LV3';
  return mod.toUpperCase();
}

export const QuestionBankView: React.FC<QuestionBankViewProps> = ({
  db,
  canEdit = true,
  loading = false,
  onRefresh,
  onNotify,
}) => {
  const [subTab, setSubTab] = useState<'questions' | 'sets'>('questions');

  // Import / Export modal state
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportScopeMode, setExportScopeMode] = useState<'all' | 'current'>('all');
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFileName, setImportFileName] = useState('');
  const [importRawText, setImportRawText] = useState('');
  const [importExcelWorkbook, setImportExcelWorkbook] =
    useState<ParsedExcelWorkbookData | null>(null);
  const [importExcelSheet, setImportExcelSheet] = useState('');
  const [isDraggingImportFile, setIsDraggingImportFile] = useState(false);
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [importingBank, setImportingBank] = useState(false);

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

  // Add/Edit Knowledge Category form & readiness state
  const [categoryStatusFilter, setCategoryStatusFilter] = useState<
    'all' | 'enabled' | 'disabled'
  >('all');
  const [togglingCategoryKey, setTogglingCategoryKey] = useState<string | null>(null);
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [editingCategoryRecord, setEditingCategoryRecord] =
    useState<KnowledgeCategoryRecord | null>(null);
  const [categoryForm, setCategoryForm] = useState({
    code: '',
    title: '',
    description: '',
    isEnabled: true,
  });
  const [savingCategory, setSavingCategory] = useState(false);
  const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(null);

  // Add/Edit Part form & readiness state
  const [partStatusFilter, setPartStatusFilter] = useState<
    'all' | 'enabled' | 'disabled'
  >('all');
  const [togglingPartKey, setTogglingPartKey] = useState<string | null>(null);
  const [batchTogglingParts, setBatchTogglingParts] = useState<
    'enable' | 'disable' | null
  >(null);
  const [showAddPartForm, setShowAddPartForm] = useState(false);
  const [editingPartRecord, setEditingPartRecord] =
    useState<KnowledgePart | null>(null);
  const [newPartCode, setNewPartCode] = useState('');
  const [newPartTitle, setNewPartTitle] = useState('');
  const [newPartDesc, setNewPartDesc] = useState('');
  const [newPartEnabled, setNewPartEnabled] = useState(true);
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
          isEnabled: true,
        });
      }
    }

    return [...defined, ...extras];
  }, [db.knowledgeCategories, knowledgeParts, db.questions, selectedModule]);

  const categoryReadinessSummary = useMemo(
    () => summarizeKnowledgeCategoryReadiness(currentModuleCategories),
    [currentModuleCategories]
  );

  const filteredModuleCategories = useMemo(
    () =>
      filterKnowledgeCategoriesByReadiness(
        currentModuleCategories,
        categoryStatusFilter
      ),
    [currentModuleCategories, categoryStatusFilter]
  );

  const selectedCategoryRecord = useMemo(() => {
    if (!selectedCategory) return null;
    return (
      currentModuleCategories.find(
        (c) => c.code.toUpperCase() === selectedCategory.toUpperCase()
      ) ?? null
    );
  }, [currentModuleCategories, selectedCategory]);

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
          isEnabled: true,
        });
      }
    }

    return [...defined, ...extras];
  }, [knowledgeParts, db.questions, selectedModule, selectedCategory, allModules]);

  const partReadinessSummary = useMemo(
    () => summarizeKnowledgePartReadiness(currentCategoryParts),
    [currentCategoryParts]
  );

  const partBatchToggleState = useMemo(
    () => canBatchToggleKnowledgeParts(currentCategoryParts),
    [currentCategoryParts]
  );

  const filteredCategoryParts = useMemo(
    () => filterKnowledgePartsByReadiness(currentCategoryParts, partStatusFilter),
    [currentCategoryParts, partStatusFilter]
  );

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
    setCategoryStatusFilter('all');
    setPartStatusFilter('all');
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
    setPartStatusFilter('all');
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
      setPartStatusFilter('all');
      setShowAddPartForm(false);
      setEditingPartRecord(null);
      return;
    }
    if (selectedModule) {
      setSelectedModule(null);
      setCategoryStatusFilter('all');
      setPartStatusFilter('all');
      setShowCategoryForm(false);
    }
  }

  const parsedImport = useMemo(() => {
    if (importExcelWorkbook) {
      return parseQuestionBankExcelSheet(importExcelWorkbook, importExcelSheet, {
        module: selectedModule ?? undefined,
        level: selectedModule ? getLevelForModule(selectedModule) : undefined,
        category: selectedCategory ?? undefined,
        contentCode: selectedPartCode ?? undefined,
      });
    }
    if (!importRawText.trim()) return null;
    return parseQuestionBankImportInput(importRawText, importFileName);
  }, [
    importExcelWorkbook,
    importExcelSheet,
    importRawText,
    importFileName,
    selectedModule,
    selectedCategory,
    selectedPartCode,
    allModules,
  ]);

  function triggerDownload(filename: string, content: BlobPart, mimeType: string) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function handleOpenExportModal() {
    setExportScopeMode(selectedModule ? 'current' : 'all');
    setShowExportModal(true);
  }

  function handleExportFile(format: 'xlsx' | 'json' | 'csv') {
    const scope =
      exportScopeMode === 'current' && selectedModule
        ? {
            module: selectedModule,
            category: selectedCategory ?? undefined,
            contentCode: selectedPartCode ?? undefined,
          }
        : undefined;
    const pkg = buildQuestionBankExportPackage(db, scope);
    if (pkg.questions.length === 0 && pkg.modules.length === 0) {
      onNotify('Không có dữ liệu câu hỏi trong phạm vi đã chọn để xuất.', true);
      return;
    }
    const stamp = new Date().toISOString().slice(0, 10);
    const suffix =
      exportScopeMode === 'current' && selectedModule
        ? `${selectedPartCode || selectedCategory || selectedModule}`.toLowerCase()
        : 'full';
    if (format === 'xlsx') {
      const xlsxBytes = buildQuestionBankExcelBuffer(pkg, 'export');
      triggerDownload(
        `ic3-question-bank-${suffix}-${stamp}.xlsx`,
        xlsxBytes as unknown as BlobPart,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      onNotify(
        `Đã xuất ${pkg.questions.length} câu hỏi ra tệp Excel (.xlsx).`
      );
    } else if (format === 'json') {
      triggerDownload(
        `ic3-question-bank-${suffix}-${stamp}.json`,
        JSON.stringify(pkg, null, 2),
        'application/json;charset=utf-8'
      );
      onNotify(
        `Đã xuất ${pkg.questions.length} câu hỏi và ${pkg.questionSets.length} bộ đề ra tệp JSON.`
      );
    } else {
      triggerDownload(
        `ic3-question-bank-${suffix}-${stamp}.csv`,
        formatQuestionBankToCsv(pkg.questions),
        'text/csv;charset=utf-8'
      );
      onNotify(`Đã xuất ${pkg.questions.length} câu hỏi ra tệp CSV (UTF-8).`);
    }
    setShowExportModal(false);
  }

  function handleDownloadSampleFile(format: 'xlsx' | 'json' | 'csv') {
    const sampleQuestions: Question[] = [
      {
        id: 'q_sample_single_01',
        module: selectedModule ?? 'computing_fundamentals',
        level: selectedModule ? getLevelForModule(selectedModule) : 'LV1',
        category: selectedCategory ?? 'GM',
        contentCode: selectedPartCode ?? 'GM1',
        topicOrder: 1,
        topic: 'Câu hỏi mẫu nhập liệu',
        type: 'single',
        prompt: 'Phím tắt nào dùng để sao chép văn bản hoặc tệp tin đang chọn?',
        instruction: 'Chọn một đáp án đúng nhất.',
        payload: {
          options: [
            { id: 'a', text: 'Ctrl + C' },
            { id: 'b', text: 'Ctrl + V' },
            { id: 'c', text: 'Ctrl + X' },
            { id: 'd', text: 'Ctrl + Z' },
          ],
          correctOptionId: 'a',
        },
        explanation: 'Ctrl + C sao chép đối tượng vào Clipboard.',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'q_sample_tf_02',
        module: selectedModule ?? 'computing_fundamentals',
        level: selectedModule ? getLevelForModule(selectedModule) : 'LV1',
        category: selectedCategory ?? 'GM',
        contentCode: selectedPartCode ?? 'GM1',
        topicOrder: 2,
        topic: 'Câu hỏi mẫu nhập liệu',
        type: 'true_false',
        prompt: 'Xác định Đúng hoặc Sai cho từng phát biểu về thiết bị lưu trữ:',
        instruction: 'Chọn Đúng hoặc Sai cho mỗi ý bên dưới.',
        payload: {
          statements: [
            {
              id: 's1',
              text: 'Ổ cứng SSD đọc ghi nhanh hơn ổ cứng HDD truyền thống.',
              isTrue: true,
            },
            {
              id: 's2',
              text: 'RAM vẫn giữ toàn bộ dữ liệu sau khi tắt nguồn hoàn toàn.',
              isTrue: false,
            },
          ],
        },
        explanation: 'RAM là bộ nhớ khả biến, dữ liệu sẽ mất khi tắt nguồn.',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
    if (format === 'xlsx') {
      const emptyPkg = buildQuestionBankExportPackage({
        modules: db.modules,
        knowledgeCategories: db.knowledgeCategories,
        knowledgeParts: db.knowledgeParts,
        questions: [],
        questionSets: [],
      });
      const xlsxBytes = buildQuestionBankExcelBuffer(emptyPkg, 'template', {
        module: selectedModule ?? undefined,
        level: selectedModule ? getLevelForModule(selectedModule) : undefined,
        category: selectedCategory ?? undefined,
        contentCode: selectedPartCode ?? undefined,
      });
      triggerDownload(
        'ic3-question-bank-sample.xlsx',
        xlsxBytes as unknown as BlobPart,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
    } else if (format === 'json') {
      const samplePkg = buildQuestionBankExportPackage({
        modules: db.modules,
        knowledgeCategories: db.knowledgeCategories,
        knowledgeParts: db.knowledgeParts,
        questions: sampleQuestions,
        questionSets: [],
      });
      triggerDownload(
        'ic3-question-bank-sample.json',
        JSON.stringify(samplePkg, null, 2),
        'application/json;charset=utf-8'
      );
    } else {
      triggerDownload(
        'ic3-question-bank-sample.csv',
        formatQuestionBankToCsv(sampleQuestions),
        'text/csv;charset=utf-8'
      );
    }
  }

  async function processImportFile(file: File) {
    const lower = file.name.toLowerCase();
    try {
      if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
        const buffer = await file.arrayBuffer();
        const workbook = readExcelWorkbookBuffer(buffer);
        setImportExcelWorkbook(workbook);
        setImportExcelSheet(workbook.activeSheetName);
        setImportRawText('');
        setImportFileName(file.name);
        return;
      }
      const text = await file.text();
      setImportExcelWorkbook(null);
      setImportExcelSheet('');
      setImportFileName(file.name);
      setImportRawText(text);
    } catch {
      onNotify(
        'Không đọc được tệp đã chọn. Hãy kiểm tra đúng định dạng .xlsx, .xls, .json hoặc .csv.',
        true
      );
    }
  }

  async function handleSelectImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    await processImportFile(file);
    e.target.value = '';
  }

  async function handleDropImportFile(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setIsDraggingImportFile(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      await processImportFile(file);
    }
  }

  async function handleConfirmImport() {
    if (!parsedImport) {
      onNotify('Vui lòng chọn file Excel/JSON/CSV hoặc dán dữ liệu câu hỏi cần nhập.', true);
      return;
    }
    if (parsedImport.errors.length > 0) {
      onNotify(parsedImport.errors[0], true);
      return;
    }
    if (
      parsedImport.bundle.questions.length === 0 &&
      parsedImport.bundle.modules.length === 0
    ) {
      onNotify('Không có câu hỏi hợp lệ nào để nhập.', true);
      return;
    }
    setImportingBank(true);
    try {
      const res = await api.importQuestionBankFromRemote({
        modules: parsedImport.bundle.modules,
        knowledgeCategories: parsedImport.bundle.knowledgeCategories,
        knowledgeParts: parsedImport.bundle.knowledgeParts,
        questions: parsedImport.bundle.questions,
        questionSets: parsedImport.bundle.questionSets,
        mode: importMode,
      });
      if (importMode === 'replace') {
        setSelectedModule(null);
        setSelectedCategory(null);
        setSelectedPartCode(null);
      }
      setShowImportModal(false);
      setImportFileName('');
      setImportRawText('');
      setImportExcelWorkbook(null);
      setImportExcelSheet('');
      await onRefresh();
      onNotify(
        importMode === 'replace'
          ? `Đã thay thế Ngân hàng Câu hỏi (${res.counts.questions} câu hỏi, ${res.counts.questionSets} bộ đề).`
          : `Đã nhập & gộp ${parsedImport.bundle.questions.length} câu hỏi vào Ngân hàng Câu hỏi.`
      );
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Không thể nhập Ngân hàng Câu hỏi.',
        true
      );
    } finally {
      setImportingBank(false);
    }
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
      if (editingModuleRecord) {
        await api.updateModule(editingModuleRecord.id, {
          level,
          title,
          description: moduleForm.description.trim(),
        });
      } else {
        await api.createModule({
          level,
          code,
          title,
          description: moduleForm.description.trim(),
        });
      }
      setShowModuleForm(false);
      setEditingModuleRecord(null);
      await onRefresh();
      onNotify(
        editingModuleRecord
          ? `Đã cập nhật Mô-đun ${level}.`
          : `Đã thêm Mô-đun ${level} mới.`
      );
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
      await onRefresh();
      onNotify(`Đã xóa Mô-đun ${mod.level}.`);
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
      isEnabled: true,
    });
    setShowCategoryForm(true);
  }

  function openEditCategoryForm(cat: KnowledgeCategoryRecord) {
    setEditingCategoryRecord(cat);
    setCategoryForm({
      code: cat.code,
      title: cat.title,
      description: cat.description,
      isEnabled: isKnowledgeCategoryEnabled(cat),
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
      if (editingCategoryRecord) {
        await api.updateKnowledgeCategory(editingCategoryRecord.id, {
          title,
          description: categoryForm.description.trim(),
          isEnabled: categoryForm.isEnabled,
        });
      } else {
        await api.createKnowledgeCategory({
          module: selectedModule,
          code,
          title,
          description: categoryForm.description.trim(),
          isEnabled: categoryForm.isEnabled,
        });
      }
      setShowCategoryForm(false);
      setEditingCategoryRecord(null);
      await onRefresh();
      onNotify(
        editingCategoryRecord
          ? `Đã cập nhật nhóm kiến thức ${code}.`
          : `Đã thêm nhóm kiến thức ${code}.`
      );
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Không thể lưu nhóm kiến thức.',
        true
      );
    } finally {
      setSavingCategory(false);
    }
  }

  async function handleToggleCategoryReadiness(cat: KnowledgeCategoryRecord) {
    if (!canEdit || !selectedModule || togglingCategoryKey) return;
    const nextEnabled = !isKnowledgeCategoryEnabled(cat);
    const toggleKey = `${cat.module}:${cat.code}`;
    setTogglingCategoryKey(toggleKey);
    try {
      if (cat.id.startsWith('virtual_cat_')) {
        await api.createKnowledgeCategory({
          module: selectedModule,
          code: cat.code,
          title: cat.title,
          description: cat.description,
          isEnabled: nextEnabled,
        });
      } else {
        await api.updateKnowledgeCategory(cat.id, {
          isEnabled: nextEnabled,
        });
      }
      await onRefresh();
      onNotify(
        nextEnabled
          ? `Đã bật nhóm ${cat.code} sẵn sàng cho học sinh làm bài.`
          : `Đã tạm tắt nhóm ${cat.code} (chưa mở cho học sinh làm bài).`
      );
    } catch (err) {
      onNotify(
        err instanceof Error
          ? err.message
          : 'Không thể cập nhật trạng thái sẵn sàng của nhóm kiến thức.',
        true
      );
    } finally {
      setTogglingCategoryKey(null);
    }
  }

  async function handleDeleteCategory(cat: KnowledgeCategoryRecord) {
    setDeletingCategoryId(cat.id);
    try {
      await api.deleteKnowledgeCategory(cat.id);
      await onRefresh();
      onNotify(`Đã xóa nhóm kiến thức ${cat.code}.`);
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
    setNewPartEnabled(true);
    setShowAddPartForm(true);
  }

  function openEditPartForm(part: KnowledgePart) {
    setEditingPartRecord(part);
    setNewPartCode(part.code);
    setNewPartTitle(part.title);
    setNewPartDesc(part.description);
    setNewPartEnabled(isKnowledgePartEnabled(part));
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
      if (editingPartRecord) {
        await api.updateKnowledgePart(editingPartRecord.id, {
          title,
          description: newPartDesc.trim(),
          isEnabled: newPartEnabled,
        });
      } else {
        await api.createKnowledgePart({
          module: selectedModule,
          level: getLevelForModule(selectedModule),
          category: selectedCategory,
          code,
          title,
          description: newPartDesc.trim(),
          isEnabled: newPartEnabled,
        });
      }
      const wasEditing = Boolean(editingPartRecord);
      setNewPartCode('');
      setNewPartTitle('');
      setNewPartDesc('');
      setNewPartEnabled(true);
      setEditingPartRecord(null);
      setShowAddPartForm(false);
      await onRefresh();
      onNotify(
        wasEditing
          ? `Đã cập nhật phần kiến thức ${code}.`
          : `Đã thêm phần kiến thức ${code}.`
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Không thể lưu phần kiến thức.', true);
    } finally {
      setSavingPart(false);
    }
  }

  async function handleTogglePartReadiness(part: KnowledgePart) {
    if (
      !canEdit ||
      !selectedModule ||
      !selectedCategory ||
      togglingPartKey ||
      batchTogglingParts
    ) {
      return;
    }
    const nextEnabled = !isKnowledgePartEnabled(part);
    const toggleKey = `${part.module}:${part.category}:${part.code}`;
    setTogglingPartKey(toggleKey);
    try {
      if (part.id.startsWith('virtual_')) {
        await api.createKnowledgePart({
          module: selectedModule,
          level: getLevelForModule(selectedModule),
          category: selectedCategory,
          code: part.code,
          title: part.title,
          description: part.description,
          isEnabled: nextEnabled,
        });
      } else {
        await api.updateKnowledgePart(part.id, {
          isEnabled: nextEnabled,
        });
      }
      await onRefresh();
      onNotify(
        nextEnabled
          ? `Đã bật phần ${part.code} sẵn sàng cho học sinh làm bài.`
          : `Đã tạm tắt phần ${part.code} (chưa mở cho học sinh làm bài).`
      );
    } catch (err) {
      onNotify(
        err instanceof Error
          ? err.message
          : 'Không thể cập nhật trạng thái sẵn sàng của phần kiến thức.',
        true
      );
    } finally {
      setTogglingPartKey(null);
    }
  }

  async function handleBatchToggleCategoryParts(nextEnabled: boolean) {
    if (
      !canEdit ||
      !selectedModule ||
      !selectedCategory ||
      currentCategoryParts.length === 0 ||
      batchTogglingParts ||
      togglingPartKey
    ) {
      return;
    }
    setBatchTogglingParts(nextEnabled ? 'enable' : 'disable');
    try {
      const virtualParts = currentCategoryParts
        .filter((p) => p.id.startsWith('virtual_'))
        .map((p) => ({
          code: p.code,
          title: p.title,
          description: p.description,
        }));
      const res = await api.batchToggleKnowledgePartsReadiness({
        module: selectedModule,
        level: getLevelForModule(selectedModule),
        category: selectedCategory,
        isEnabled: nextEnabled,
        virtualParts: virtualParts.length > 0 ? virtualParts : undefined,
      });
      await onRefresh();
      const count = res.updatedCount || currentCategoryParts.length;
      onNotify(
        nextEnabled
          ? `Đã bật tất cả ${count} phần của nhóm ${selectedCategory} sẵn sàng cho học sinh làm bài.`
          : `Đã tạm tắt tất cả ${count} phần của nhóm ${selectedCategory} (chưa mở cho học sinh).`
      );
    } catch (err) {
      onNotify(
        err instanceof Error
          ? err.message
          : 'Không thể cập nhật hàng loạt trạng thái sẵn sàng cho các phần.',
        true
      );
    } finally {
      setBatchTogglingParts(null);
    }
  }

  async function handleDeletePart(part: KnowledgePart) {
    setDeletingPartId(part.id);
    try {
      await api.deleteKnowledgePart(part.id);
      await onRefresh();
      onNotify(`Đã xóa phần ${part.code}.`);
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
    if (existingId) {
      await api.updateQuestion(existingId, payload);
    } else {
      await api.createQuestion(payload);
    }
    await onRefresh();
    onNotify(existingId ? 'Đã cập nhật câu hỏi.' : 'Đã thêm câu hỏi mới vào phần kiến thức.');
  }

  async function handleDeleteQuestion(q: Question) {
    setDeletingQuestionId(q.id);
    try {
      await api.deleteQuestion(q.id);
      setSelectedQuestionIds((prev) => prev.filter((id) => id !== q.id));
      await onRefresh();
      onNotify(`Đã xóa Câu ${q.topicOrder}.`);
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
    setDeletingBatchQuestions(true);
    try {
      await api.batchDeleteQuestions(ids);
      setSelectedQuestionIds([]);
      setConfirmBatchDelete(false);
      await onRefresh();
      onNotify(`Đã xóa ${ids.length} câu hỏi đã chọn.`);
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
      await onRefresh();
      onNotify('Đã cập nhật số thứ tự câu hỏi trong phần.');
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
      if (editingSet) {
        await api.updateQuestionSet(editingSet.id, setForm);
      } else {
        await api.createQuestionSet(setForm);
      }
      await onRefresh();
      setShowSetModal(false);
      onNotify(
        editingSet
          ? `Đã cập nhật bộ đề "${setForm.title}".`
          : `Đã tạo bộ đề "${setForm.title}".`
      );
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
      await onRefresh();
      onNotify(`Đã xóa bộ đề "${set.title}".`);
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
          {SHOW_QUESTION_BANK_IMPORT_EXPORT && (
            <>
              <button
                type="button"
                onClick={handleOpenExportModal}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>Xuất ngân hàng</span>
              </button>

              {canEdit && (
                <button
                  type="button"
                  onClick={() => setShowImportModal(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                  <span>Nhập Excel / File</span>
                </button>
              )}
            </>
          )}

          {canEdit && (subTab === 'questions' ? (
            <>
              {!selectedModule && (
                <button
                  type="button"
                  onClick={openNewModuleForm}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Thêm Mô-đun (Level)</span>
                </button>
              )}
              {selectedModule && !selectedCategory && (
                <button
                  type="button"
                  onClick={openNewCategoryForm}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Thêm Nhóm kiến thức</span>
                </button>
              )}
              {selectedModule && selectedCategory && !selectedPartCode && (
                <button
                  type="button"
                  onClick={openNewPartForm}
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
          ))}
        </div>
      </div>

      {!canEdit && (
        <div
          role="status"
          data-testid="qb-readonly-banner"
          className="rounded-xl border border-sky-200 dark:border-sky-900/60 bg-sky-50/80 dark:bg-sky-950/40 px-4 py-3 text-xs text-sky-800 dark:text-sky-200"
        >
          <strong>Chế độ Chỉ xem (GV Giảng dạy · LV1):</strong> Bạn có thể tra cứu toàn bộ Mô-đun, Nhóm, Phần, Câu hỏi và Bộ đề để giao bài tập; quyền thêm, sửa, xóa Ngân hàng câu hỏi dành cho GV Chuyên môn (LV2) và Giáo viên Master.
        </div>
      )}

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
                    setCategoryStatusFilter('all');
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

              {loading ? (
                <CardGridSkeleton
                  count={3}
                  columnsClassName="grid-cols-1 md:grid-cols-3 gap-4"
                  ariaLabel="Đang tải danh sách mô-đun..."
                />
              ) : (
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
                                .map((code) => {
                                  const catRec = modCats.find(
                                    (c) => c.code.toUpperCase() === code.toUpperCase()
                                  );
                                  const offSuffix =
                                    catRec && !isKnowledgeCategoryEnabled(catRec)
                                      ? ' · Tạm tắt'
                                      : '';
                                  return `${code} (${modQuestions.filter((q) => q.category === code).length}${offSuffix})`;
                                })
                                .join(' · ')
                            : 'Chưa có nhóm kiến thức'}
                        </div>
                      </button>

                      <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-1.5">
                          {canEdit && !isVirtual && (
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
                          {canEdit && canDelete && (
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
              )}
            </section>
          )}

          {/* STEP 2: Knowledge Categories (GM, OT, custom...) of selected Module */}
          {selectedModule && !selectedCategory && (
            <section aria-label="Chọn Nhóm kiến thức" className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
                <div>
                  <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                    Bước 2: Chọn hoặc Quản lý Nhóm kiến thức — {getModuleTitle(selectedModule)}
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Chọn nhóm kiến thức để mở danh sách các phần tương ứng, hoặc bật/tắt trạng thái sẵn sàng cho học sinh làm bài.
                  </p>
                  {!loading && categoryReadinessSummary.total > 0 && (
                    <p
                      data-testid="category-readiness-summary"
                      className="text-xs font-medium text-slate-600 dark:text-slate-300 mt-1.5 tabular-nums"
                    >
                      Sẵn sàng cho học sinh:{' '}
                      <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                        {categoryReadinessSummary.enabledCount}/{categoryReadinessSummary.total} nhóm
                      </span>
                      {categoryReadinessSummary.disabledCount > 0 && (
                        <span className="text-amber-700 dark:text-amber-400">
                          {' '}
                          ({categoryReadinessSummary.disabledCount} nhóm đang tạm tắt)
                        </span>
                      )}
                    </p>
                  )}
                </div>

                {!loading && currentModuleCategories.length > 0 && (
                  <div
                    role="group"
                    aria-label="Lọc nhóm kiến thức theo trạng thái sẵn sàng"
                    className="inline-flex items-center bg-slate-200/70 dark:bg-slate-800/80 p-1 rounded-xl shrink-0 self-start sm:self-auto"
                  >
                    <button
                      type="button"
                      onClick={() => setCategoryStatusFilter('all')}
                      className={`px-3 py-1 text-xs font-medium rounded-lg transition-all cursor-pointer ${
                        categoryStatusFilter === 'all'
                          ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      Tất cả ({categoryReadinessSummary.total})
                    </button>
                    <button
                      type="button"
                      onClick={() => setCategoryStatusFilter('enabled')}
                      className={`px-3 py-1 text-xs font-medium rounded-lg transition-all cursor-pointer ${
                        categoryStatusFilter === 'enabled'
                          ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 shadow-sm'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      Đã mở HS ({categoryReadinessSummary.enabledCount})
                    </button>
                    <button
                      type="button"
                      onClick={() => setCategoryStatusFilter('disabled')}
                      className={`px-3 py-1 text-xs font-medium rounded-lg transition-all cursor-pointer ${
                        categoryStatusFilter === 'disabled'
                          ? 'bg-white dark:bg-slate-900 text-amber-700 dark:text-amber-400 shadow-sm'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      Tạm tắt ({categoryReadinessSummary.disabledCount})
                    </button>
                  </div>
                )}
              </div>

              {loading ? (
                <CardGridSkeleton
                  count={2}
                  columnsClassName="grid-cols-1 md:grid-cols-2 gap-4"
                  ariaLabel="Đang tải danh sách nhóm kiến thức..."
                />
              ) : currentModuleCategories.length === 0 ? (
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-10 text-center space-y-3">
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    Mô-đun {getLevelForModule(selectedModule)} hiện chưa có nhóm kiến thức nào.
                  </p>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={openNewCategoryForm}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Thêm Nhóm kiến thức đầu tiên</span>
                    </button>
                  )}
                </div>
              ) : filteredModuleCategories.length === 0 ? (
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-8 text-center space-y-3">
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    Không có nhóm kiến thức nào ở trạng thái đã lọc.
                  </p>
                  <button
                    type="button"
                    onClick={() => setCategoryStatusFilter('all')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    Xem tất cả nhóm
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {filteredModuleCategories.map((cat) => {
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
                    const isEnabled = isKnowledgeCategoryEnabled(cat);
                    const toggleKey = `${cat.module}:${cat.code}`;
                    const isToggling = togglingCategoryKey === toggleKey;

                    return (
                      <article
                        key={cat.code}
                        data-testid={`category-card-${cat.code}`}
                        className={`border rounded-xl flex flex-col justify-between transition-colors group ${
                          isEnabled
                            ? 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-blue-500 dark:hover:border-blue-500'
                            : 'bg-slate-50/90 dark:bg-slate-900/60 border-amber-200/80 dark:border-amber-900/60 hover:border-amber-400 dark:hover:border-amber-700'
                        }`}
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
                          <div className="flex items-start justify-between gap-2">
                            <h3
                              className={`font-display text-base font-semibold transition-colors ${
                                isEnabled
                                  ? 'text-slate-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400'
                                  : 'text-slate-700 dark:text-slate-300 group-hover:text-amber-700 dark:group-hover:text-amber-300'
                              }`}
                            >
                              {cat.title}
                            </h3>
                          </div>
                          <p className="text-xs text-slate-600 dark:text-slate-400">
                            {cat.description || 'Chưa có mô tả cho nhóm kiến thức này.'}
                          </p>
                          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
                            <div className="text-slate-500 dark:text-slate-400">
                              Các phần hiện có:{' '}
                              <span
                                className={
                                  partCodes.length > 0
                                    ? 'font-mono font-medium text-slate-700 dark:text-slate-300'
                                    : 'italic text-slate-500 dark:text-slate-400'
                                }
                              >
                                {partCodes.length > 0
                                  ? partCodes
                                      .map((pCode) => {
                                        const pRec = catParts.find(
                                          (p) =>
                                            p.code.toUpperCase() === pCode.toUpperCase()
                                        );
                                        return pRec && !isKnowledgePartEnabled(pRec)
                                          ? `${pCode} (Tạm tắt)`
                                          : pCode;
                                      })
                                      .join(', ')
                                  : 'Chưa có phần nào'}
                              </span>
                            </div>
                            <span
                              data-testid={`category-status-${cat.code}`}
                              className={`inline-flex items-center gap-1 font-medium ${
                                isEnabled
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : 'text-amber-700 dark:text-amber-400'
                              }`}
                            >
                              {isEnabled ? (
                                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                              ) : (
                                <PauseCircle className="w-3.5 h-3.5 shrink-0" />
                              )}
                              <span>
                                {isEnabled
                                  ? 'Sẵn sàng cho HS làm bài'
                                  : 'Tạm tắt · Chưa mở HS'}
                              </span>
                            </span>
                          </div>
                        </button>

                        <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
                          <div className="flex flex-wrap items-center gap-2">
                            {canEdit && (
                              <button
                                type="button"
                                role="switch"
                                aria-checked={isEnabled}
                                aria-label={
                                  isEnabled
                                    ? `Tạm tắt nhóm ${cat.code} cho học sinh`
                                    : `Bật sẵn sàng nhóm ${cat.code} cho học sinh`
                                }
                                disabled={isToggling}
                                onClick={() => handleToggleCategoryReadiness(cat)}
                                className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-lg border font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer ${
                                  isEnabled
                                    ? 'border-emerald-200 dark:border-emerald-800/80 bg-emerald-50/80 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100/70 dark:hover:bg-emerald-950/70'
                                    : 'border-amber-200 dark:border-amber-800/80 bg-amber-50/80 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 hover:bg-amber-100/70 dark:hover:bg-amber-950/70'
                                }`}
                              >
                                {isToggling ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                                ) : (
                                  <span
                                    aria-hidden="true"
                                    className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${
                                      isEnabled
                                        ? 'bg-emerald-600 dark:bg-emerald-500'
                                        : 'bg-slate-400 dark:bg-slate-600'
                                    }`}
                                  >
                                    <span
                                      className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                                        isEnabled ? 'translate-x-3.5' : 'translate-x-0.5'
                                      }`}
                                    />
                                  </span>
                                )}
                                <span>
                                  {isToggling
                                    ? 'Đang lưu...'
                                    : isEnabled
                                      ? 'Đang mở HS'
                                      : 'Đang tắt'}
                                </span>
                              </button>
                            )}
                            {canEdit && !isVirtual && (
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
                            {canEdit && canDelete && (
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
                            {!canEdit && isVirtual && (
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
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
                <div>
                  <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                    Bước 3: Các phần của nhóm {selectedCategory} — {getModuleTitle(selectedModule)}
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Chọn một phần kiến thức (VD: {selectedCategory}1, {selectedCategory}2...) để quản lý ngân hàng câu hỏi, hoặc bật/tắt trạng thái sẵn sàng cho học sinh làm bài.
                  </p>
                  {!loading && partReadinessSummary.total > 0 && (
                    <p
                      data-testid="part-readiness-summary"
                      className="text-xs font-medium text-slate-600 dark:text-slate-300 mt-1.5 tabular-nums"
                    >
                      Sẵn sàng cho học sinh:{' '}
                      <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                        {partReadinessSummary.enabledCount}/{partReadinessSummary.total} phần
                      </span>
                      {partReadinessSummary.disabledCount > 0 && (
                        <span className="text-amber-700 dark:text-amber-400">
                          {' '}
                          ({partReadinessSummary.disabledCount} phần đang tạm tắt)
                        </span>
                      )}
                    </p>
                  )}
                </div>

                {!loading && currentCategoryParts.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
                    {canEdit && (
                      <div
                        role="group"
                        aria-label={`Thao tác nhanh trạng thái tất cả phần nhóm ${selectedCategory}`}
                        className="inline-flex items-center gap-1.5"
                      >
                        <button
                          type="button"
                          data-testid="parts-enable-all-btn"
                          aria-label={`Bật tất cả phần thuộc nhóm ${selectedCategory} cho học sinh`}
                          disabled={
                            !partBatchToggleState.canEnableAll ||
                            Boolean(batchTogglingParts) ||
                            Boolean(togglingPartKey)
                          }
                          onClick={() => handleBatchToggleCategoryParts(true)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-emerald-200 dark:border-emerald-800/80 bg-emerald-50/80 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100/80 dark:hover:bg-emerald-950/70 disabled:opacity-45 disabled:cursor-not-allowed transition-colors whitespace-nowrap cursor-pointer"
                        >
                          {batchTogglingParts === 'enable' ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                          ) : (
                            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                          )}
                          <span>
                            {batchTogglingParts === 'enable'
                              ? 'Đang bật...'
                              : 'Bật tất cả'}
                          </span>
                        </button>
                        <button
                          type="button"
                          data-testid="parts-disable-all-btn"
                          aria-label={`Tắt tất cả phần thuộc nhóm ${selectedCategory} cho học sinh`}
                          disabled={
                            !partBatchToggleState.canDisableAll ||
                            Boolean(batchTogglingParts) ||
                            Boolean(togglingPartKey)
                          }
                          onClick={() => handleBatchToggleCategoryParts(false)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-amber-200 dark:border-amber-800/80 bg-amber-50/80 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 hover:bg-amber-100/80 dark:hover:bg-amber-950/70 disabled:opacity-45 disabled:cursor-not-allowed transition-colors whitespace-nowrap cursor-pointer"
                        >
                          {batchTogglingParts === 'disable' ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                          ) : (
                            <PauseCircle className="w-3.5 h-3.5 shrink-0" />
                          )}
                          <span>
                            {batchTogglingParts === 'disable'
                              ? 'Đang tắt...'
                              : 'Tắt tất cả'}
                          </span>
                        </button>
                      </div>
                    )}

                    <div
                      role="group"
                      aria-label="Lọc phần kiến thức theo trạng thái sẵn sàng"
                      className="inline-flex items-center bg-slate-200/70 dark:bg-slate-800/80 p-1 rounded-xl shrink-0"
                    >
                      <button
                        type="button"
                        onClick={() => setPartStatusFilter('all')}
                        className={`px-3 py-1 text-xs font-medium rounded-lg transition-all cursor-pointer ${
                          partStatusFilter === 'all'
                            ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        Tất cả ({partReadinessSummary.total})
                      </button>
                      <button
                        type="button"
                        onClick={() => setPartStatusFilter('enabled')}
                        className={`px-3 py-1 text-xs font-medium rounded-lg transition-all cursor-pointer ${
                          partStatusFilter === 'enabled'
                            ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 shadow-sm'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        Đã mở HS ({partReadinessSummary.enabledCount})
                      </button>
                      <button
                        type="button"
                        onClick={() => setPartStatusFilter('disabled')}
                        className={`px-3 py-1 text-xs font-medium rounded-lg transition-all cursor-pointer ${
                          partStatusFilter === 'disabled'
                            ? 'bg-white dark:bg-slate-900 text-amber-700 dark:text-amber-400 shadow-sm'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        Tạm tắt ({partReadinessSummary.disabledCount})
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {selectedCategoryRecord && !isKnowledgeCategoryEnabled(selectedCategoryRecord) && (
                <div
                  role="status"
                  className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/80 dark:bg-amber-950/30 px-4 py-2.5 text-xs text-amber-800 dark:text-amber-200 flex items-center justify-between gap-3"
                >
                  <span>
                    Nhóm <strong>{selectedCategory}</strong> hiện đang ở trạng thái{' '}
                    <strong>Tạm tắt</strong> (chưa mở cho học sinh làm bài). Bạn vẫn có thể soạn các phần và câu hỏi bên trong.
                  </span>
                </div>
              )}

              {loading ? (
                <CardGridSkeleton
                  count={6}
                  columnsClassName="grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
                  ariaLabel="Đang tải danh sách các phần kiến thức..."
                />
              ) : currentCategoryParts.length === 0 ? (
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-10 text-center space-y-3">
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    Nhóm {selectedCategory} hiện chưa có phần kiến thức nào.
                  </p>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={openNewPartForm}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Thêm Phần {selectedCategory} đầu tiên</span>
                    </button>
                  )}
                </div>
              ) : filteredCategoryParts.length === 0 ? (
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-8 text-center space-y-3">
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    Không có phần kiến thức nào ở trạng thái đã lọc.
                  </p>
                  <button
                    type="button"
                    onClick={() => setPartStatusFilter('all')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    Xem tất cả phần
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredCategoryParts.map((part) => {
                  const qs = getPartQuestionsSorted(
                    db.questions,
                    selectedModule,
                    selectedCategory,
                    part.code
                  );
                  const isVirtual = part.id.startsWith('virtual_');
                  const minOrder = qs[0]?.topicOrder;
                  const maxOrder = qs[qs.length - 1]?.topicOrder;
                  const isEnabled = isKnowledgePartEnabled(part);
                  const toggleKey = `${part.module}:${part.category}:${part.code}`;
                  const isToggling = togglingPartKey === toggleKey;

                  return (
                    <article
                      key={part.id}
                      data-testid={`part-card-${part.code}`}
                      className={`border rounded-xl transition-colors group flex flex-col justify-between ${
                        isEnabled
                          ? 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-blue-500 dark:hover:border-blue-500'
                          : 'bg-slate-50/90 dark:bg-slate-900/60 border-amber-200/80 dark:border-amber-900/60 hover:border-amber-400 dark:hover:border-amber-700'
                      }`}
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
                        <h3
                          className={`font-display text-base font-semibold transition-colors ${
                            isEnabled
                              ? 'text-slate-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400'
                              : 'text-slate-700 dark:text-slate-300 group-hover:text-amber-700 dark:group-hover:text-amber-300'
                          }`}
                        >
                          {part.title}
                        </h3>
                        <p className="text-xs text-slate-600 dark:text-slate-400">
                          {part.description || 'Chưa có mô tả cho phần kiến thức này.'}
                        </p>
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
                          <span className="text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                            {qs.length > 0
                              ? `Thứ tự câu: Câu ${minOrder} – Câu ${maxOrder}`
                              : 'Chưa có câu hỏi nào'}
                          </span>
                          <span
                            data-testid={`part-status-${part.code}`}
                            className={`inline-flex items-center gap-1 font-medium ${
                              isEnabled
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-amber-700 dark:text-amber-400'
                            }`}
                          >
                            {isEnabled ? (
                              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                            ) : (
                              <PauseCircle className="w-3.5 h-3.5 shrink-0" />
                            )}
                            <span>
                              {isEnabled
                                ? 'Sẵn sàng cho HS làm bài'
                                : 'Tạm tắt · Chưa mở HS'}
                            </span>
                          </span>
                        </div>
                      </button>

                      <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {canEdit && (
                            <button
                              type="button"
                              role="switch"
                              aria-checked={isEnabled}
                              aria-label={
                                isEnabled
                                  ? `Tạm tắt phần ${part.code} cho học sinh`
                                  : `Bật sẵn sàng phần ${part.code} cho học sinh`
                              }
                              disabled={isToggling || Boolean(batchTogglingParts)}
                              onClick={() => handleTogglePartReadiness(part)}
                              className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-lg border font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer ${
                                isEnabled
                                  ? 'border-emerald-200 dark:border-emerald-800/80 bg-emerald-50/80 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100/70 dark:hover:bg-emerald-950/70'
                                  : 'border-amber-200 dark:border-amber-800/80 bg-amber-50/80 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 hover:bg-amber-100/70 dark:hover:bg-amber-950/70'
                              }`}
                            >
                              {isToggling ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                              ) : (
                                <span
                                  aria-hidden="true"
                                  className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${
                                    isEnabled
                                      ? 'bg-emerald-600 dark:bg-emerald-500'
                                      : 'bg-slate-400 dark:bg-slate-600'
                                  }`}
                                >
                                  <span
                                    className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                                      isEnabled ? 'translate-x-3.5' : 'translate-x-0.5'
                                    }`}
                                  />
                                </span>
                              )}
                              <span>
                                {isToggling
                                  ? 'Đang lưu...'
                                  : isEnabled
                                    ? 'Đang mở HS'
                                    : 'Đang tắt'}
                              </span>
                            </button>
                          )}
                          {canEdit && !isVirtual && (
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
                          {canEdit && !isVirtual && qs.length === 0 && (
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
              )}
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

                {canEdit && partQuestionsSorted.length > 0 && (
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

              {activePartMeta && !isKnowledgePartEnabled(activePartMeta) && (
                <div
                  role="status"
                  className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/80 dark:bg-amber-950/30 px-4 py-2.5 text-xs text-amber-800 dark:text-amber-200 flex items-center justify-between gap-3"
                >
                  <span>
                    Phần <strong>{selectedPartCode}</strong> hiện đang ở trạng thái{' '}
                    <strong>Tạm tắt</strong> (chưa mở cho học sinh làm bài). Bạn vẫn có thể thêm, sửa và sắp xếp câu hỏi bên trong.
                  </span>
                </div>
              )}

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
                  <option value="all">Tất cả 6 dạng câu hỏi</option>
                  {Object.entries(QUESTION_TYPE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>

              {/* Bulk Selection & Actions Bar */}
              {canEdit && (filteredPartQuestions.length > 0 || activeSelectedQuestions.length > 0) && (
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
              {loading ? (
                <ListSkeleton
                  variant="questionCard"
                  rows={5}
                  ariaLabel="Đang tải danh sách câu hỏi..."
                />
              ) : (
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
                          {canEdit && (
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleQuestionSelection(q.id)}
                              aria-label={`Chọn Câu ${q.topicOrder}: ${q.prompt}`}
                              className="mt-1 h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-blue-600 cursor-pointer shrink-0"
                            />
                          )}
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

                      {canEdit && (
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
                      )}
                    </div>

                    {/* Optional Illustration Image (for non-hotspot types) */}
                    {q.type !== 'hotspot' && 'imageUrl' in q.payload && q.payload.imageUrl && (
                      <div className="pt-1">
                        <img
                          src={q.payload.imageUrl}
                          alt={q.payload.imageAlt?.trim() || `Hình minh họa Câu ${q.topicOrder}`}
                          referrerPolicy="no-referrer"
                          className="max-h-64 w-auto max-w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 object-contain"
                        />
                      </div>
                    )}

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
                      {q.type === 'matrix_choice' &&
                        'slots' in q.payload &&
                        'options' in q.payload && (() => {
                          const matrixPayload = q.payload;
                          return (
                          <div className="space-y-2.5">
                            {matrixPayload.templateText?.trim() && (
                              <div className="space-y-1 text-slate-700 dark:text-slate-200 whitespace-pre-line leading-relaxed">
                                {matrixPayload.templateText.split(/(_\(\d+\)_)/g).map((part, pIdx) =>
                                  /^_\(\d+\)_$/.test(part) ? (
                                    <span
                                      key={pIdx}
                                      className="font-mono font-bold text-red-600 dark:text-red-400 underline decoration-slate-400 mx-0.5"
                                    >
                                      {part.slice(1, -1)}
                                    </span>
                                  ) : (
                                    <React.Fragment key={pIdx}>{part}</React.Fragment>
                                  )
                                )}
                              </div>
                            )}
                            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                              <table className="w-full text-[11px] border-collapse">
                                <thead>
                                  <tr className="bg-blue-600 text-white">
                                    <th className="px-2.5 py-1.5 text-left font-semibold border-r border-blue-500/60 w-14">
                                      Vị trí
                                    </th>
                                    {matrixPayload.options.map((opt) => (
                                      <th
                                        key={opt.id}
                                        className="px-2.5 py-1.5 text-center font-semibold border-r border-blue-500/60 last:border-r-0"
                                      >
                                        {opt.text}
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900">
                                  {matrixPayload.slots.map((slot) => (
                                    <tr key={slot.id}>
                                      <td className="px-2.5 py-1.5 font-mono font-bold text-red-600 dark:text-red-400 border-r border-slate-200 dark:border-slate-800">
                                        {slot.label}
                                      </td>
                                      {matrixPayload.options.map((opt) => {
                                        const isCorrect = slot.correctOptionId === opt.id;
                                        return (
                                          <td
                                            key={opt.id}
                                            className={`px-2.5 py-1.5 text-center border-r border-slate-200 dark:border-slate-800 last:border-r-0 ${
                                              isCorrect
                                                ? 'bg-emerald-50/70 dark:bg-emerald-950/30'
                                                : ''
                                            }`}
                                          >
                                            <span
                                              aria-label={isCorrect ? 'Đáp án đúng' : 'Không chọn'}
                                              className={`inline-block w-3.5 h-3.5 rounded-full border align-middle ${
                                                isCorrect
                                                  ? 'border-emerald-600 bg-emerald-600 ring-2 ring-emerald-200 dark:ring-emerald-900'
                                                  : 'border-slate-400 dark:border-slate-600'
                                              }`}
                                            />
                                          </td>
                                        );
                                      })}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                          );
                        })()}
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
                    {canEdit && partQuestionsSorted.length === 0 && (
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
              )}
            </section>
          )}
        </div>
      ) : loading ? (
        <CardGridSkeleton
          count={4}
          columnsClassName="grid-cols-1 md:grid-cols-2 gap-4"
          ariaLabel="Đang tải danh sách bộ đề..."
        />
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
              {canEdit && (
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
              )}
            </article>
          ))}
        </div>
      )}

      {canEdit && showQuestionModal && (
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
                  <span>{savingSet ? 'Đang lưu...' : 'Lưu Bộ đề'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Thêm / Sửa Mô-đun (Level) */}
      {canEdit && showModuleForm && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="module-modal-title"
          className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
          onClick={() => {
            if (!savingModule) {
              setShowModuleForm(false);
              setEditingModuleRecord(null);
            }
          }}
        >
          <div
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-lg shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
              <h3
                id="module-modal-title"
                className="font-display text-base font-semibold text-slate-900 dark:text-white"
              >
                {editingModuleRecord
                  ? `Chỉnh sửa Mô-đun ${editingModuleRecord.level}`
                  : 'Thêm Mô-đun (Level) mới'}
              </h3>
              <button
                type="button"
                disabled={savingModule}
                onClick={() => {
                  setShowModuleForm(false);
                  setEditingModuleRecord(null);
                }}
                aria-label="Đóng biểu mẫu mô-đun"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveModule} className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
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
                <div>
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
              </div>
              <div>
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
              <div>
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
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={savingModule}
                  onClick={() => {
                    setShowModuleForm(false);
                    setEditingModuleRecord(null);
                  }}
                  className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-50 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={savingModule}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {savingModule && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>
                    {savingModule
                      ? 'Đang lưu...'
                      : editingModuleRecord
                        ? 'Cập nhật Mô-đun'
                        : 'Lưu Mô-đun mới'}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Thêm / Sửa Nhóm kiến thức */}
      {canEdit && showCategoryForm && selectedModule && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="category-modal-title"
          className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
          onClick={() => {
            if (!savingCategory) {
              setShowCategoryForm(false);
              setEditingCategoryRecord(null);
            }
          }}
        >
          <div
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-lg shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
              <h3
                id="category-modal-title"
                className="font-display text-base font-semibold text-slate-900 dark:text-white"
              >
                {editingCategoryRecord
                  ? `Chỉnh sửa Nhóm ${editingCategoryRecord.code}`
                  : `Thêm Nhóm kiến thức vào ${getLevelForModule(selectedModule)}`}
              </h3>
              <button
                type="button"
                disabled={savingCategory}
                onClick={() => {
                  setShowCategoryForm(false);
                  setEditingCategoryRecord(null);
                }}
                aria-label="Đóng biểu mẫu nhóm kiến thức"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveCategory} className="p-6 space-y-4">
              <div>
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
              <div>
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
              <div>
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
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-3">
                <label
                  htmlFor="cat-enabled"
                  className="flex items-start gap-2.5 cursor-pointer select-none"
                >
                  <input
                    id="cat-enabled"
                    type="checkbox"
                    checked={categoryForm.isEnabled}
                    onChange={(e) =>
                      setCategoryForm({
                        ...categoryForm,
                        isEnabled: e.target.checked,
                      })
                    }
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                  />
                  <span className="space-y-0.5">
                    <span className="block text-xs font-semibold text-slate-900 dark:text-white">
                      Sẵn sàng cho học sinh làm bài
                    </span>
                    <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                      Bật khi nhóm kiến thức đã đủ câu hỏi để học sinh làm bài; bỏ chọn để tạm tắt trong quá trình biên soạn.
                    </span>
                  </span>
                </label>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={savingCategory}
                  onClick={() => {
                    setShowCategoryForm(false);
                    setEditingCategoryRecord(null);
                  }}
                  className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-50 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={savingCategory}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {savingCategory && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>
                    {savingCategory
                      ? 'Đang lưu...'
                      : editingCategoryRecord
                        ? 'Cập nhật Nhóm'
                        : 'Lưu Nhóm mới'}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Thêm / Sửa Phần kiến thức */}
      {canEdit && showAddPartForm && selectedModule && selectedCategory && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="part-modal-title"
          className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
          onClick={() => {
            if (!savingPart) {
              setShowAddPartForm(false);
              setEditingPartRecord(null);
            }
          }}
        >
          <div
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-lg shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
              <h3
                id="part-modal-title"
                className="font-display text-base font-semibold text-slate-900 dark:text-white"
              >
                {editingPartRecord
                  ? `Chỉnh sửa Phần ${editingPartRecord.code}`
                  : `Thêm Phần kiến thức vào ${getLevelForModule(selectedModule)} · ${selectedCategory}`}
              </h3>
              <button
                type="button"
                disabled={savingPart}
                onClick={() => {
                  setShowAddPartForm(false);
                  setEditingPartRecord(null);
                }}
                aria-label="Đóng biểu mẫu phần kiến thức"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSavePart} className="p-6 space-y-4">
              <div>
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
              <div>
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
              <div>
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
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-3">
                <label
                  htmlFor="new-part-enabled"
                  className="flex items-start gap-2.5 cursor-pointer select-none"
                >
                  <input
                    id="new-part-enabled"
                    type="checkbox"
                    checked={newPartEnabled}
                    onChange={(e) => setNewPartEnabled(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                  />
                  <span className="space-y-0.5">
                    <span className="block text-xs font-semibold text-slate-900 dark:text-white">
                      Sẵn sàng cho học sinh làm bài
                    </span>
                    <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                      Bật khi phần kiến thức đã đủ câu hỏi để học sinh làm bài; bỏ chọn để tạm tắt trong quá trình biên soạn.
                    </span>
                  </span>
                </label>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={savingPart}
                  onClick={() => {
                    setShowAddPartForm(false);
                    setEditingPartRecord(null);
                  }}
                  className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-50 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={savingPart}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {savingPart && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>
                    {savingPart
                      ? 'Đang lưu...'
                      : editingPartRecord
                        ? 'Cập nhật Phần'
                        : 'Lưu Phần mới'}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Xuất Ngân hàng Câu hỏi */}
      {SHOW_QUESTION_BANK_IMPORT_EXPORT && showExportModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="export-qb-modal-title"
          className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
          onClick={() => setShowExportModal(false)}
        >
          <div
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-2xl shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
              <div>
                <h3
                  id="export-qb-modal-title"
                  className="font-display text-base font-semibold text-slate-900 dark:text-white"
                >
                  Xuất Ngân hàng Câu hỏi
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Tải về tệp Excel để soạn thảo hàng loạt hoặc tệp JSON sao lưu toàn bộ cấu trúc.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowExportModal(false)}
                aria-label="Đóng hộp thoại xuất ngân hàng"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                  1. Chọn phạm vi dữ liệu cần xuất
                </div>
                <div className="grid grid-cols-1 gap-2">
                  <label className="flex items-start gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-950/60 cursor-pointer">
                    <input
                      type="radio"
                      name="export-scope"
                      checked={exportScopeMode === 'all'}
                      onChange={() => setExportScopeMode('all')}
                      className="mt-0.5"
                    />
                    <div className="text-xs">
                      <div className="font-semibold text-slate-900 dark:text-white">
                        Toàn bộ Ngân hàng Câu hỏi
                      </div>
                      <div className="text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                        {allModules.length} mô-đun · {db.questions.length} câu hỏi ·{' '}
                        {db.questionSets.length} bộ đề
                      </div>
                    </div>
                  </label>

                  {selectedModule && (
                    <label className="flex items-start gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-950/60 cursor-pointer">
                      <input
                        type="radio"
                        name="export-scope"
                        checked={exportScopeMode === 'current'}
                        onChange={() => setExportScopeMode('current')}
                        className="mt-0.5"
                      />
                      <div className="text-xs">
                        <div className="font-semibold text-slate-900 dark:text-white">
                          Chỉ nhánh đang xem ({getLevelForModule(selectedModule)}
                          {selectedCategory ? ` · ${selectedCategory}` : ''}
                          {selectedPartCode ? ` · ${selectedPartCode}` : ''})
                        </div>
                        <div className="text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                          {
                            buildQuestionBankExportPackage(db, {
                              module: selectedModule,
                              category: selectedCategory ?? undefined,
                              contentCode: selectedPartCode ?? undefined,
                            }).questions.length
                          }{' '}
                          câu hỏi thuộc nhánh hiện tại
                        </div>
                      </div>
                    </label>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                  2. Chọn định dạng tệp tải xuống
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <button
                    type="button"
                    onClick={() => handleExportFile('xlsx')}
                    className="flex items-start gap-3 p-3.5 rounded-lg border border-emerald-300 dark:border-emerald-800 hover:border-emerald-500 dark:hover:border-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/20 text-left transition-colors cursor-pointer"
                  >
                    <FileSpreadsheet className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="text-xs font-semibold text-slate-900 dark:text-white">
                        Tải tệp Excel (.xlsx)
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        Đầy đủ cột đáp án A–D, bảng Bộ đề và sheet hướng dẫn.
                      </p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleExportFile('json')}
                    className="flex items-start gap-3 p-3.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-blue-500 dark:hover:border-blue-500 bg-white dark:bg-slate-950 text-left transition-colors cursor-pointer"
                  >
                    <FileJson className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="text-xs font-semibold text-slate-900 dark:text-white">
                        Tải tệp JSON (.json)
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        Sao lưu trọn vẹn 4 tầng phân cấp, cả 6 dạng &amp; bộ đề.
                      </p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleExportFile('csv')}
                    className="flex items-start gap-3 p-3.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-500 bg-white dark:bg-slate-950 text-left transition-colors cursor-pointer"
                  >
                    <FileSpreadsheet className="w-5 h-5 text-slate-600 dark:text-slate-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="text-xs font-semibold text-slate-900 dark:text-white">
                        Tải tệp CSV (.csv)
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        Chuẩn UTF-8 BOM nhẹ, mở nhanh trên mọi phần mềm bảng tính.
                      </p>
                    </div>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Nhập Ngân hàng Câu hỏi (Excel / JSON / CSV) */}
      {SHOW_QUESTION_BANK_IMPORT_EXPORT && canEdit && showImportModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="import-qb-modal-title"
          className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
          onClick={() => {
            if (!importingBank) setShowImportModal(false);
          }}
        >
          <div
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
              <div>
                <h3
                  id="import-qb-modal-title"
                  className="font-display text-base font-semibold text-slate-900 dark:text-white"
                >
                  Nhập hàng loạt Câu hỏi từ Excel / JSON / CSV
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Tải lên file Excel (.xlsx, .xls), CSV hoặc JSON để kiểm tra trước và nhập thẳng vào hệ thống.
                </p>
              </div>
              <button
                type="button"
                disabled={importingBank}
                onClick={() => setShowImportModal(false)}
                aria-label="Đóng hộp thoại nhập ngân hàng"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-5">
              {/* Khu vực tải file Excel/JSON/CSV & tải biểu mẫu */}
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                    1. Chọn tệp Excel (.xlsx, .xls) hoặc JSON / CSV
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleDownloadSampleFile('xlsx')}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-emerald-300 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100/70 dark:hover:bg-emerald-950/50 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5" />
                      <span>Tải Excel mẫu (.xlsx)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDownloadSampleFile('json')}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <FileJson className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                      <span>JSON mẫu</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDownloadSampleFile('csv')}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5 text-slate-500" />
                      <span>CSV mẫu</span>
                    </button>
                  </div>
                </div>

                <label
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDraggingImportFile(true);
                  }}
                  onDragLeave={() => setIsDraggingImportFile(false)}
                  onDrop={handleDropImportFile}
                  className={`flex flex-col sm:flex-row items-center justify-between gap-3 p-4 rounded-xl border-2 border-dashed transition-colors cursor-pointer ${
                    isDraggingImportFile
                      ? 'border-blue-500 bg-blue-50/60 dark:bg-blue-950/30'
                      : 'border-slate-300 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-950/50 hover:border-blue-400 dark:hover:border-blue-600'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 flex items-center justify-center shrink-0">
                      <Upload className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 text-xs">
                      <div className="font-semibold text-slate-900 dark:text-white truncate">
                        {importFileName
                          ? `Đã nạp tệp: ${importFileName}`
                          : 'Kéo thả hoặc nhấn để chọn tệp Excel (.xlsx, .xls), CSV, JSON'}
                      </div>
                      <div className="text-slate-500 dark:text-slate-400 mt-0.5">
                        Hỗ trợ các cột chuẩn (module, category, contentCode, type, prompt, optionA–F, correctAnswer...) hoặc tiêu đề tiếng Việt.
                      </div>
                    </div>
                  </div>
                  <span className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 whitespace-nowrap shrink-0">
                    Chọn tệp
                  </span>
                  <input
                    id="qb-import-file-input"
                    type="file"
                    accept=".xlsx,.xls,.json,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/json,text/csv"
                    onChange={handleSelectImportFile}
                    className="sr-only"
                  />
                </label>

                {importExcelWorkbook && importExcelWorkbook.sheetNames.length > 1 && (
                  <div className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
                    <label
                      htmlFor="qb-excel-sheet-select"
                      className="text-xs font-medium text-slate-700 dark:text-slate-300"
                    >
                      Chọn Sheet dữ liệu câu hỏi trong file Excel:
                    </label>
                    <select
                      id="qb-excel-sheet-select"
                      value={importExcelSheet}
                      onChange={(e) => setImportExcelSheet(e.target.value)}
                      className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                    >
                      {importExcelWorkbook.sheetNames.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {!importExcelWorkbook && (
                <div>
                  <label
                    htmlFor="qb-import-textarea"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    Hoặc dán trực tiếp nội dung JSON / CSV vào đây
                  </label>
                  <textarea
                    id="qb-import-textarea"
                    rows={4}
                    value={importRawText}
                    onChange={(e) => {
                      setImportExcelWorkbook(null);
                      setImportExcelSheet('');
                      setImportRawText(e.target.value);
                      if (!e.target.value.trim()) setImportFileName('');
                    }}
                    placeholder='{"questions": [...]} hoặc dán nội dung CSV có cột type, prompt...'
                    className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                  />
                </div>
              )}

              {parsedImport && (
                <div className="space-y-3">
                  <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs font-semibold text-slate-900 dark:text-white">
                        Xem trước dữ liệu hợp lệ
                        {importExcelWorkbook && importExcelSheet
                          ? ` (Sheet "${importExcelSheet}")`
                          : ''}
                      </div>
                      {importExcelWorkbook && (
                        <button
                          type="button"
                          onClick={() => {
                            setImportExcelWorkbook(null);
                            setImportExcelSheet('');
                            setImportFileName('');
                          }}
                          className="text-[11px] font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
                        >
                          Xóa tệp đang chọn
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-300 tabular-nums">
                      <span>{parsedImport.bundle.modules.length} mô-đun</span>
                      <span aria-hidden="true">·</span>
                      <span>{parsedImport.bundle.knowledgeCategories.length} nhóm</span>
                      <span aria-hidden="true">·</span>
                      <span>{parsedImport.bundle.knowledgeParts.length} phần</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-semibold text-blue-600 dark:text-blue-400">
                        {parsedImport.bundle.questions.length} câu hỏi
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{parsedImport.bundle.questionSets.length} bộ đề</span>
                    </div>

                    {parsedImport.bundle.questions.length > 0 && (
                      <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto bg-white dark:bg-slate-900">
                        <table className="w-full text-left text-[11px]">
                          <thead className="bg-slate-100/80 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300">
                            <tr>
                              <th className="px-2.5 py-1.5 font-semibold w-10">#</th>
                              <th className="px-2.5 py-1.5 font-semibold whitespace-nowrap">Phân cấp</th>
                              <th className="px-2.5 py-1.5 font-semibold whitespace-nowrap">Dạng</th>
                              <th className="px-2.5 py-1.5 font-semibold">Nội dung câu hỏi</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {parsedImport.bundle.questions.slice(0, 5).map((q, i) => (
                              <tr key={`${q.id}_${i}`}>
                                <td className="px-2.5 py-1.5 tabular-nums text-slate-500">
                                  {i + 1}
                                </td>
                                <td className="px-2.5 py-1.5 font-mono whitespace-nowrap text-slate-700 dark:text-slate-300">
                                  {q.level} · {q.contentCode}
                                </td>
                                <td className="px-2.5 py-1.5 whitespace-nowrap text-slate-600 dark:text-slate-400">
                                  {QUESTION_TYPE_LABELS[q.type]}
                                </td>
                                <td className="px-2.5 py-1.5 text-slate-900 dark:text-slate-100 max-w-xs truncate">
                                  {q.prompt}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {parsedImport.bundle.questions.length > 5 && (
                          <div className="px-2.5 py-1.5 text-[11px] text-slate-500 dark:text-slate-400 border-t border-slate-100 dark:border-slate-800 tabular-nums">
                            ...và {parsedImport.bundle.questions.length - 5} câu hỏi khác đã sẵn sàng nhập.
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {parsedImport.errors.length > 0 && (
                    <div
                      role="alert"
                      className="p-3 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-xs text-red-700 dark:text-red-300 space-y-1 max-h-36 overflow-y-auto"
                    >
                      <div className="font-semibold">
                        Phát hiện {parsedImport.errors.length} lỗi dữ liệu:
                      </div>
                      {parsedImport.errors.slice(0, 8).map((err, idx) => (
                        <div key={idx}>{err}</div>
                      ))}
                    </div>
                  )}

                  {parsedImport.warnings.length > 0 && parsedImport.errors.length === 0 && (
                    <div className="p-3 rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 text-xs text-amber-800 dark:text-amber-300 space-y-1 max-h-24 overflow-y-auto">
                      {parsedImport.warnings.slice(0, 4).map((w, idx) => (
                        <div key={idx}>{w}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                  2. Chế độ nhập dữ liệu
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="flex items-start gap-2.5 p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 cursor-pointer">
                    <input
                      type="radio"
                      name="import-mode"
                      checked={importMode === 'merge'}
                      onChange={() => setImportMode('merge')}
                      className="mt-0.5"
                    />
                    <div className="text-xs">
                      <div className="font-semibold text-slate-900 dark:text-white">
                        Gộp &amp; cập nhật (Khuyên dùng)
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        Giữ dữ liệu hiện có, thêm mới và ghi đè các câu trùng ID.
                      </p>
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 cursor-pointer">
                    <input
                      type="radio"
                      name="import-mode"
                      checked={importMode === 'replace'}
                      onChange={() => setImportMode('replace')}
                      className="mt-0.5"
                    />
                    <div className="text-xs">
                      <div className="font-semibold text-red-700 dark:text-red-400">
                        Thay thế toàn bộ ngân hàng
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        Xóa câu hỏi &amp; bộ đề cũ không có trong tệp nhập.
                      </p>
                    </div>
                  </label>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                disabled={importingBank}
                onClick={() => setShowImportModal(false)}
                className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-50 cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={
                  importingBank ||
                  !parsedImport ||
                  parsedImport.errors.length > 0 ||
                  (parsedImport.bundle.questions.length === 0 &&
                    parsedImport.bundle.modules.length === 0)
                }
                onClick={handleConfirmImport}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {importingBank && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{importingBank ? 'Đang nhập...' : 'Xác nhận nhập dữ liệu'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
