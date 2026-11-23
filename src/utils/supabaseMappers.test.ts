import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeedDatabase } from '../data/seedData';
import {
  buildFullDatabaseSupabasePayload,
  ensureSupabaseUuid,
  mapBattleConfigRowToDomain,
  mapBattleRoomsFromRows,
  mapBreakStateRowToDomain,
  mapClassRowToDomain,
  mapClassTaskConfigsFromRows,
  mapQuestionBankRowsToDomain,
  mapSchoolRowToDomain,
  mapStudentRowToDomain,
  mapSubmissionsFromRows,
} from './supabaseMappers';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

test('ensureSupabaseUuid preserves valid UUIDs and deterministically converts non-UUID strings', () => {
  const realUuid = '550e8400-e29b-41d4-a716-446655440000';
  assert.equal(ensureSupabaseUuid(realUuid), realUuid);

  const a1 = ensureSupabaseUuid('room_6a1_live');
  const a2 = ensureSupabaseUuid('room_6a1_live');
  const b = ensureSupabaseUuid('room_6a1_history_01');
  assert.equal(a1, a2);
  assert.notEqual(a1, b);
  assert.match(a1, UUID_PATTERN);
  assert.match(b, UUID_PATTERN);
});

test('buildFullDatabaseSupabasePayload maps all 17 tables cleanly with valid UUIDs and FK consistency', () => {
  const seed = createSeedDatabase();
  const payload = buildFullDatabaseSupabasePayload(seed);

  assert.equal(payload.schools.length, seed.schools.length);
  assert.equal(payload.classes.length, seed.classes.length);
  assert.equal(payload.students.length, seed.students.length);
  assert.equal(payload.adminTeachers.length, seed.teachers.length);
  assert.equal(payload.modules.length, seed.modules.length);
  assert.equal(payload.categories.length, seed.knowledgeCategories.length);
  assert.equal(payload.parts.length, seed.knowledgeParts.length);
  assert.equal(payload.questions.length, seed.questions.length);
  assert.equal(payload.questionSets.length, seed.questionSets.length);
  assert.equal(payload.classTaskConfigs.length, seed.classTaskConfigs.length);
  assert.equal(payload.submissions.length, seed.submissions.length);
  assert.equal(payload.breakStates.length, seed.breakStates.length);
  assert.equal(payload.battleConfigs.length, seed.battleConfigs.length);
  assert.equal(payload.battleRooms.length, seed.battleRooms.length);

  for (const sub of payload.submissions) {
    assert.match(sub.id, UUID_PATTERN);
  }
  for (const room of payload.battleRooms) {
    assert.match(room.id, UUID_PATTERN);
  }
  for (const p of payload.battleParticipants) {
    assert.match(p.room_id, UUID_PATTERN);
  }
  for (const ev of payload.battleEvents) {
    assert.match(ev.id, UUID_PATTERN);
    assert.match(ev.room_id, UUID_PATTERN);
  }
});

test('domain row mappers round-trip schools, classes, students, question bank, tasks, submissions, breaks, and battles', () => {
  const seed = createSeedDatabase();
  const payload = buildFullDatabaseSupabasePayload(seed);

  const schools = payload.schools.map((r) => mapSchoolRowToDomain(r as unknown as Record<string, unknown>));
  assert.deepEqual(schools, seed.schools);

  const classes = payload.classes.map((r) => mapClassRowToDomain(r as unknown as Record<string, unknown>));
  assert.deepEqual(classes, seed.classes);

  const students = payload.students.map((r) => mapStudentRowToDomain(r as unknown as Record<string, unknown>));
  assert.deepEqual(students, seed.students);

  const qb = mapQuestionBankRowsToDomain({
    moduleRows: payload.modules as unknown as Array<Record<string, unknown>>,
    categoryRows: payload.categories as unknown as Array<Record<string, unknown>>,
    partRows: payload.parts as unknown as Array<Record<string, unknown>>,
    questionRows: payload.questions as unknown as Array<Record<string, unknown>>,
    setRows: payload.questionSets as unknown as Array<Record<string, unknown>>,
  });
  assert.equal(qb.modules.length, seed.modules.length);
  assert.equal(qb.questions.length, seed.questions.length);
  assert.equal(qb.questionSets.length, seed.questionSets.length);

  const taskConfigs = mapClassTaskConfigsFromRows(
    payload.classTaskConfigs as unknown as Array<Record<string, unknown>>,
    payload.classTasks as unknown as Array<Record<string, unknown>>
  );
  assert.equal(taskConfigs.length, seed.classTaskConfigs.length);
  assert.equal(taskConfigs[0].tasks.length, seed.classTaskConfigs[0].tasks.length);

  const subs = mapSubmissionsFromRows(
    payload.submissions as unknown as Array<Record<string, unknown>>,
    students,
    taskConfigs
  );
  assert.equal(subs.length, seed.submissions.length);
  assert.equal(subs[0].studentName, seed.submissions[0].studentName);
  assert.equal(subs[0].taskTitle, seed.submissions[0].taskTitle);

  const breaks = payload.breakStates.map((r) =>
    mapBreakStateRowToDomain(r as unknown as Record<string, unknown>)
  );
  assert.equal(breaks.length, seed.breakStates.length);
  assert.equal(breaks[0].status, seed.breakStates[0].status);

  const bConfigs = payload.battleConfigs.map((r) =>
    mapBattleConfigRowToDomain(r as unknown as Record<string, unknown>)
  );
  assert.equal(bConfigs.length, seed.battleConfigs.length);

  const rooms = mapBattleRoomsFromRows(
    payload.battleRooms as unknown as Array<Record<string, unknown>>,
    payload.battleParticipants as unknown as Array<Record<string, unknown>>,
    payload.battleEvents as unknown as Array<Record<string, unknown>>
  );
  assert.equal(rooms.length, seed.battleRooms.length);
  assert.equal(rooms[0].participants.length, seed.battleRooms[0].participants.length);
  assert.equal(rooms[0].events.length, seed.battleRooms[0].events.length);
});
