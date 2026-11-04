/**
 * study.ts 單測（node + tsx）
 * 例：day1 5000s → 3600；day2 1000 → total 4600 → entitled 7（10分＝1抽）；抽 1 後 remaining 6
 */
import {
  computeCreditedSeconds,
  entitledDrawsFromCredited,
  remainingDraws,
  summarizeStudy,
  filterRowsForEmail,
  emailPairMismatch,
  type StudyRow,
} from "../src/study";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

const rows: StudyRow[] = [
  {
    recordedAt: "2026-10-01T10:00:00+08:00",
    validSeconds: 5000,
    googleEmail: "a@wahyan.edu.hk",
  },
  {
    recordedAt: "2026-10-02T11:00:00+08:00",
    validSeconds: 1000,
    googleEmail: "a@wahyan.edu.hk",
  },
  {
    recordedAt: "2026-10-02T12:00:00+08:00",
    validSeconds: 999,
    googleEmail: "other@wahyan.edu.hk",
  },
];

const mine = filterRowsForEmail(rows, "A@WahYan.edu.hk");
assert(mine.length === 2, "email match case-insensitive, 2 rows");

const credited = computeCreditedSeconds(mine);
assert(credited === 4600, `credited should be 4600, got ${credited}`);

const entitled = entitledDrawsFromCredited(credited);
assert(entitled === 7, `entitled should be 7 (4600/600), got ${entitled}`);

assert(remainingDraws(credited, 0) === 7, "remaining 7 before draw");
assert(remainingDraws(credited, 1) === 6, "remaining 6 after 1 draw");

const sum = summarizeStudy(rows, "a@wahyan.edu.hk", 1);
assert(sum.creditedSec === 4600, "summary credited");
assert(sum.entitledDraws === 7, "summary entitled");
assert(sum.remainingDraws === 6, "summary remaining");
assert(sum.creditedMinutes === 76, "4600/60 = 76 minutes floor");

const sameDay: StudyRow[] = [
  { recordedAt: "2026-10-05T09:00:00+08:00", validSeconds: 2000, googleEmail: "b@x.com" },
  { recordedAt: "2026-10-05T15:00:00+08:00", validSeconds: 2000, googleEmail: "b@x.com" },
];
assert(computeCreditedSeconds(sameDay) === 3600, "same-day cap 3600");

const fb: StudyRow[] = [
  {
    recordedAt: "2026-10-06T10:00:00+08:00",
    validSeconds: 1200,
    googleEmail: "",
    inputEmail: "c@wahyan.edu.hk",
  },
];
assert(filterRowsForEmail(fb, "c@wahyan.edu.hk").length === 1, "fallback input email");
assert(entitledDrawsFromCredited(600) === 1, "exactly 10 min = 1 draw");
assert(entitledDrawsFromCredited(599) === 0, "under 10 min = 0");
assert(entitledDrawsFromCredited(1200) === 2, "exactly 20 min = 2 draws");


// --- emailPairMismatch ---
assert(
  !emailPairMismatch([], "a@x.com"),
  "no rows → no mismatch"
);
assert(
  !emailPairMismatch(
    [{ recordedAt: "2026-10-01T10:00:00+08:00", validSeconds: 100, googleEmail: "a@x.com" }],
    "a@x.com"
  ),
  "only googleEmail → no mismatch"
);
assert(
  !emailPairMismatch(
    [{ recordedAt: "2026-10-01T10:00:00+08:00", validSeconds: 100, inputEmail: "a@x.com", googleEmail: "" }],
    "a@x.com"
  ),
  "only inputEmail → no mismatch"
);
assert(
  !emailPairMismatch(
    [{ recordedAt: "2026-10-01T10:00:00+08:00", validSeconds: 100, inputEmail: "A@X.com", googleEmail: "a@x.com" }],
    "a@x.com"
  ),
  "same pair (case) → no mismatch"
);
assert(
  emailPairMismatch(
    [{ recordedAt: "2026-10-01T10:00:00+08:00", validSeconds: 100, inputEmail: "a@x.com", googleEmail: "b@x.com" }],
    "a@x.com"
  ),
  "both filled different, login=input → mismatch"
);
assert(
  emailPairMismatch(
    [{ recordedAt: "2026-10-01T10:00:00+08:00", validSeconds: 100, inputEmail: "a@x.com", googleEmail: "b@x.com" }],
    "b@x.com"
  ),
  "both filled different, login=google → mismatch"
);
assert(
  !emailPairMismatch(
    [{ recordedAt: "2026-10-01T10:00:00+08:00", validSeconds: 100, inputEmail: "a@x.com", googleEmail: "b@x.com" }],
    "c@x.com"
  ),
  "unrelated login → no mismatch"
);

console.log("OK: all study.ts assertions passed");
