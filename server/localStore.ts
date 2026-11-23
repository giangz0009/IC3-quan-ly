import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSeedDatabase } from '../src/data/seedData';
import type { AdminDatabase, AdminTeacher } from '../src/types/ic3';
import { normalizeAdminRole, normalizeTeacherStatus } from '../src/utils/ic3Rules';
import { hashTeacherPassword } from './security';

const IS_SERVERLESS = Boolean(
  process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
);
const DATA_DIR = IS_SERVERLESS
  ? path.join(os.tmpdir(), 'ic3_admin_data')
  : path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'ic3_admin_db.json');

export function createHashedSeedDatabase(): AdminDatabase {
  const seed = createSeedDatabase();
  seed.teachers = seed.teachers.map((t) => ({
    ...t,
    password: hashTeacherPassword(t.password),
  }));
  return seed;
}

function tryWriteFile(target: string, content: string): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(target, content, 'utf-8');
  } catch {
    // Graceful no-op in read-only serverless filesystems
  }
}

function loadLocalDb(): AdminDatabase {
  if (!fs.existsSync(DB_FILE)) {
    const seed = createHashedSeedDatabase();
    tryWriteFile(DB_FILE, JSON.stringify(seed, null, 2));
    return seed;
  }
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as AdminDatabase;
    const seed = createSeedDatabase();
    let changed = false;
    if (!Array.isArray(parsed.modules)) {
      parsed.modules = seed.modules;
      changed = true;
    }
    if (!Array.isArray(parsed.knowledgeCategories)) {
      parsed.knowledgeCategories = seed.knowledgeCategories;
      changed = true;
    }
    if (!Array.isArray(parsed.knowledgeParts)) {
      parsed.knowledgeParts = seed.knowledgeParts;
      changed = true;
    }
    if (!Array.isArray(parsed.teachers) || parsed.teachers.length === 0) {
      parsed.teachers = seed.teachers.map((t) => ({
        ...t,
        password: hashTeacherPassword(t.password),
      }));
      changed = true;
    } else {
      const migratedTeachers: AdminTeacher[] = [];
      for (const rawT of parsed.teachers) {
        const legacy = rawT as AdminTeacher & { schoolId?: unknown };
        const nextRole = normalizeAdminRole(legacy.role);
        const nextEmail =
          legacy.userId === 'teacher_nd_01' &&
          legacy.email === 'ha.tran@nguyendu.edu.vn'
            ? 'giangday.lv1@ic3master.edu.vn'
            : legacy.email;
        const nextStatus = normalizeTeacherStatus(legacy.status);
        const nextPassword = hashTeacherPassword(legacy.password || '');
        if (
          legacy.role !== nextRole ||
          legacy.status !== nextStatus ||
          'schoolId' in legacy ||
          nextEmail !== legacy.email ||
          nextPassword !== legacy.password
        ) {
          changed = true;
        }
        migratedTeachers.push({
          userId: legacy.userId,
          fullName: legacy.fullName,
          email: nextEmail,
          password: nextPassword,
          role: nextRole,
          status: nextStatus,
          createdAt: legacy.createdAt,
        });
      }
      if (
        !migratedTeachers.some((t) => t.role === 'teacher_lv2') &&
        migratedTeachers.some((t) => t.userId === 'teacher_admin_01') &&
        migratedTeachers.some((t) => t.userId === 'teacher_nd_01')
      ) {
        const seedLv2 = seed.teachers.find((t) => t.role === 'teacher_lv2');
        if (seedLv2 && !migratedTeachers.some((t) => t.email === seedLv2.email)) {
          migratedTeachers.splice(1, 0, {
            ...seedLv2,
            password: hashTeacherPassword(seedLv2.password),
          });
          changed = true;
        }
      }
      parsed.teachers = migratedTeachers;
    }
    const seedQuestionMap = new Map(seed.questions.map((q) => [q.id, q]));
    for (const q of parsed.questions) {
      if (!q.contentCode || typeof q.topicOrder !== 'number') {
        const ref = seedQuestionMap.get(q.id);
        q.contentCode = q.contentCode || ref?.contentCode || `${q.category}1`;
        q.topicOrder =
          typeof q.topicOrder === 'number' ? q.topicOrder : ref?.topicOrder ?? 1;
        changed = true;
      }
    }
    if (changed) {
      tryWriteFile(DB_FILE, JSON.stringify(parsed, null, 2));
    }
    return parsed;
  } catch {
    const seed = createHashedSeedDatabase();
    tryWriteFile(DB_FILE, JSON.stringify(seed, null, 2));
    return seed;
  }
}

let cachedLocalDb: AdminDatabase | null = null;

export function getLocalDb(): AdminDatabase {
  if (!cachedLocalDb) {
    cachedLocalDb = loadLocalDb();
  }
  return cachedLocalDb;
}

export function saveLocalDb(): void {
  if (!cachedLocalDb) return;
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const tmpFile = `${DB_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(cachedLocalDb, null, 2), 'utf-8');
    fs.renameSync(tmpFile, DB_FILE);
  } catch {
    // Graceful fallback if filesystem is read-only
  }
}

export function sanitizeTeachers(teachers: AdminTeacher[]) {
  return teachers.map(({ password: _pw, ...rest }) => ({
    ...rest,
    role: normalizeAdminRole(rest.role),
    status: normalizeTeacherStatus(rest.status),
  }));
}
