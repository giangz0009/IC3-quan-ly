# Lưu trữ Mô hình Dữ liệu Domain: `src/types/ic3.ts`

**Nguồn gốc:** `src/types/ic3.ts` (bản sao đầy đủ toàn bộ kiểu dữ liệu & hằng số nhãn)  
**Cập nhật bản lưu:** 2026-11-28

---

## 1. Kiểu Nguyên thủy & Phân loại

```ts
export type IC3Module = string;

export type IC3Level = string;
export type KnowledgeCategory = string;
export type QuestionType =
  | 'single'
  | 'multiple'
  | 'true_false'
  | 'matching'
  | 'hotspot'
  | 'matrix_choice';
export type QuizMode = 'practice' | 'exam';
export type HotspotType =
  | 'word_ribbon'
  | 'excel_ribbon'
  | 'pc_hardware_ports'
  | 'browser_security';

export type BattleDebuffType = 'blur' | 'frost' | 'reverse' | 'shake';
export type BattleRoomStatus = 'lobby' | 'playing' | 'finished';
export type BreakStatus = 'locked' | 'active' | 'expired';
export type AdminRole = 'teacher_lv1' | 'teacher_lv2' | 'master';
export type TeacherAccountStatus = 'active' | 'locked';
```

---

## 2. Tổ chức Trường học, Lớp học, Học sinh & Giáo viên

```ts
export interface School {
  id: string;
  name: string;
  district: string;
  createdAt: string;
}

export interface SchoolClass {
  id: string;
  schoolId: string;
  name: string;
  grade: string;
  createdAt: string;
}

export interface StudentProfile {
  id: string;
  classId: string;
  fullName: string;
  studentCode: string;
  passwordHash: string;
  isCustomPassword: boolean;
  alwaysBreakReady: boolean;
  createdAt: string;
}

export interface AdminTeacher {
  userId: string;
  fullName: string;
  email: string;
  password: string;
  role: AdminRole;
  status: TeacherAccountStatus;
  createdAt: string;
}
```

---

## 3. Ngân hàng Câu hỏi 4 tầng & 6 Dạng Câu hỏi IC3

```ts
export interface QuestionOption {
  id: string;
  text: string;
}

export interface TrueFalseStatement {
  id: string;
  text: string;
  isTrue: boolean;
  explanation?: string;
}

export interface MatchingItem {
  id: string;
  text: string;
}

export interface MatchingPair {
  leftId: string;
  rightId: string;
}

export interface MatrixChoiceSlot {
  id: string;
  label: string;
  correctOptionId: string;
}

export interface HotspotTarget {
  label: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type QuestionPayload =
  | {
      options: QuestionOption[];
      correctOptionId: string;
      imageUrl?: string;
      imageAlt?: string;
    }
  | {
      options: QuestionOption[];
      correctOptionIds: string[];
      imageUrl?: string;
      imageAlt?: string;
    }
  | {
      statements: TrueFalseStatement[];
      imageUrl?: string;
      imageAlt?: string;
    }
  | {
      matchingLeft: MatchingItem[];
      matchingRight: MatchingItem[];
      correctPairs: MatchingPair[];
      imageUrl?: string;
      imageAlt?: string;
    }
  | {
      templateText: string;
      options: QuestionOption[];
      slots: MatrixChoiceSlot[];
      imageUrl?: string;
      imageAlt?: string;
    }
  | {
      imageUrl?: string;
      hotspotType?: HotspotType;
      hotspotTarget: HotspotTarget;
      imageAlt: string;
    };

export interface IC3ModuleRecord {
  id: string;
  code: IC3Module;
  level: IC3Level;
  title: string;
  description: string;
  orderIndex: number;
}

export interface KnowledgeCategoryRecord {
  id: string;
  module: IC3Module;
  code: KnowledgeCategory;
  title: string;
  description: string;
  orderIndex: number;
  isEnabled: boolean;
}

export interface KnowledgePart {
  id: string;
  module: IC3Module;
  level: IC3Level;
  category: KnowledgeCategory;
  code: string;
  title: string;
  description: string;
  orderIndex: number;
  isEnabled: boolean;
}

export interface Question {
  id: string;
  module: IC3Module;
  level: IC3Level;
  category: KnowledgeCategory;
  contentCode: string;
  topicOrder: number;
  topic: string;
  type: QuestionType;
  prompt: string;
  instruction?: string;
  payload: QuestionPayload;
  explanation: string;
  tips?: string;
  createdAt: string;
  updatedAt: string;
}

export interface QuestionSet {
  id: string;
  title: string;
  description: string;
  level?: IC3Level;
  category?: KnowledgeCategory;
  contentCode?: string;
  questionIds: string[];
  createdAt: string;
  updatedAt: string;
}
```

---

## 4. Giao Bài tập, Nộp bài, Giải lao & Thi đấu Realtime

```ts
export interface ClassTaskItem {
  id: string;
  classId: string;
  orderIndex: number;
  title: string;
  description: string;
  level: IC3Level;
  category: KnowledgeCategory;
  contentCode: string;
  moduleFilter: 'all' | IC3Module;
  quizMode: QuizMode;
  questionIds: string[];
  estimatedMinutes: number;
  requiredAttempts: number;
  minScore: number;
}

export interface ClassTaskConfig {
  classId: string;
  assignmentTitle: string;
  teacherName: string;
  breakRewardMinutes: number;
  updatedAt: string;
  tasks: ClassTaskItem[];
}

export interface AdminTaskStatRecord {
  id: string;
  studentId: string;
  studentName: string;
  studentCode: string;
  schoolId: string;
  classId: string;
  taskId: string;
  taskTitle: string;
  score: number;
  correctCount: number;
  totalCount: number;
  durationSeconds: number;
  completedAt: string;
  attemptNumber: number;
  requiredAttempts: number;
  minScore: number;
  metMinScore: boolean;
}

export interface StudentBreakState {
  studentId: string;
  status: BreakStatus;
  totalGrantedSeconds: number;
  remainingSeconds: number;
  unlockedAt?: string;
  expiredAt?: string;
  updatedAt: string;
}

export interface ClassBattleConfig {
  classId: string;
  isEnabled: boolean;
  title: string;
  questionSetId: string | null;
  questionSetName: string;
  teacherName: string;
  moduleFilter: 'all' | IC3Module;
  questionIds: string[];
  fastComboWindowSeconds: number;
  topRewardCount: number;
  breakRewardMinutes: number;
  timeLimitSeconds: number;
  updatedAt: string;
}

export interface ActiveDebuff {
  id: string;
  type: BattleDebuffType;
  fromStudentName: string;
  expiresAt: string;
}

export interface BattleParticipant {
  roomId: string;
  studentId: string;
  studentName: string;
  studentCode: string;
  connected: boolean;
  answeredCount: number;
  correctCount: number;
  score: number;
  durationSeconds: number;
  finished: boolean;
  finishedAt?: string;
  shieldCharges: number;
  pendingCardChoices: number;
  attacksUsed: number;
  defensesUsed: number;
  attacksBlocked: number;
  activeDebuffs: ActiveDebuff[];
  currentPairCount: number;
  currentPairElapsedSeconds: number;
  joinedAt: string;
}

export interface BattleEvent {
  id: string;
  roomId: string;
  type: 'join' | 'start' | 'combo' | 'attack' | 'blocked' | 'defense' | 'finish';
  message: string;
  actorStudentId?: string;
  actorStudentName?: string;
  targetStudentId?: string;
  targetStudentName?: string;
  debuffType?: BattleDebuffType;
  createdAt: string;
}

export interface BattleRankedResult {
  rank: number;
  studentId: string;
  studentName: string;
  studentCode: string;
  score: number;
  correctCount: number;
  totalQuestions: number;
  durationSeconds: number;
  rewardedBreakMinutes: number;
}

export interface BattleRoomState {
  id: string;
  classId: string;
  status: BattleRoomStatus;
  questionIds: string[];
  configSnapshot: ClassBattleConfig;
  startedAt?: string;
  endsAt?: string;
  finishedAt?: string;
  rankedResults?: BattleRankedResult[];
  participants: BattleParticipant[];
  events: BattleEvent[];
  createdAt: string;
}

export interface AdminDatabase {
  schools: School[];
  classes: SchoolClass[];
  students: StudentProfile[];
  teachers: AdminTeacher[];
  modules: IC3ModuleRecord[];
  knowledgeCategories: KnowledgeCategoryRecord[];
  knowledgeParts: KnowledgePart[];
  questions: Question[];
  questionSets: QuestionSet[];
  classTaskConfigs: ClassTaskConfig[];
  submissions: AdminTaskStatRecord[];
  breakStates: StudentBreakState[];
  battleConfigs: ClassBattleConfig[];
  battleRooms: BattleRoomState[];
}
```

---

## 5. Hằng số Nhãn Hiển thị & Hướng dẫn Mặc định

```ts
export const MODULE_LABELS: Record<string, string> = {
  computing_fundamentals: 'Máy tính căn bản (LV1)',
  key_applications: 'Ứng dụng chủ chốt (LV2)',
  living_online: 'Cuộc sống trực tuyến (LV3)',
};

export const CATEGORY_LABELS: Record<
  string,
  { name: string; description: string }
> = {
  GM: {
    name: 'Nhóm GM — Chuẩn GMetrix',
    description: 'Kiến thức nền tảng và dạng bài bám sát cấu trúc đề thi chuẩn GMetrix.',
  },
  OT: {
    name: 'Nhóm OT — Chuyên đề Ôn tập',
    description: 'Chuyên đề ôn luyện mở rộng, bổ sung và tổng hợp theo từng phần.',
  },
};

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  single: 'Trắc nghiệm 1 đáp án',
  multiple: 'Trắc nghiệm nhiều đáp án',
  true_false: 'Đúng / Sai từng ý',
  matching: 'Ghép nối Cột A – B',
  hotspot: 'Chọn điểm trên hình (Hotspot)',
  matrix_choice: 'Điền khuyết bảng chọn (Matrix)',
};

export const QUESTION_DEFAULT_INSTRUCTIONS: Record<QuestionType, string> = {
  single: 'Chọn một đáp án đúng nhất.',
  multiple: 'Chọn TẤT CẢ đáp án đúng.',
  true_false: 'Chọn Đúng hoặc Sai cho từng ý.',
  matching: 'Chọn cặp tương ứng giữa Cột A và Cột B.',
  hotspot: 'Nhấp chuột trực tiếp vào vùng tương ứng trên hình.',
  matrix_choice:
    'Hoàn thành các chỗ trống (1), (2)... bằng cách chọn đáp án đúng cho từng dòng trong bảng.',
};

export const HOTSPOT_TYPE_LABELS: Record<HotspotType, string> = {
  word_ribbon: 'Giao diện Microsoft Word Ribbon',
  excel_ribbon: 'Giao diện Microsoft Excel Ribbon',
  pc_hardware_ports: 'Cổng kết nối Phần cứng PC',
  browser_security: 'Thanh bảo mật Trình duyệt Web',
};

export const DEBUFF_LABELS: Record<BattleDebuffType, string> = {
  blur: 'Làm mờ câu hỏi (6s)',
  frost: 'Đóng băng khung câu hỏi (6s)',
  reverse: 'Đảo ngược phương án (6s)',
  shake: 'Rung lắc giao diện (6s)',
};
```
