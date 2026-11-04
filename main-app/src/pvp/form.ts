export type FormLevel = 'F1' | 'F2' | 'F3';

export interface FormResolution {
  canPvp: boolean;
  form: FormLevel | null;
  isTeacher: boolean;
  className: string;
  reason?: string;
}

const FORM_OVERRIDE_KEY = 'wushuang_pvp_form_override';
const CLASS_CACHE_KEY = 'wushuang_pvp_class_name';

export function formFromClassName(rawClass?: string | null): FormLevel | 'SENIOR' | null {
  const s = (rawClass || '').trim().toUpperCase();
  if (!s) return null;

  if (/^(F?[456]|[456][A-Z]|中[四五六]|S[456])/.test(s)) {
    return 'SENIOR';
  }
  if (/^(F?1|1[A-Z]|中一|S1)/.test(s)) return 'F1';
  if (/^(F?2|2[A-Z]|中二|S2)/.test(s)) return 'F2';
  if (/^(F?3|3[A-Z]|中三|S3)/.test(s)) return 'F3';
  return null;
}

export function isLikelyTeacherEmail(email: string): boolean {
  const clean = (email || '').trim().toLowerCase();
  const local = clean.split('@')[0] || '';
  if (!local) return false;
  if (local === 'scchan' || local.startsWith('teacher') || local.startsWith('staff')) return true;
  if (/^[a-z._-]+$/.test(local) && !/\d/.test(local)) return true;
  return false;
}

export function loadSavedFormOverride(): FormLevel | null {
  try {
    const v = (localStorage.getItem(FORM_OVERRIDE_KEY) || '').trim().toUpperCase();
    if (v === 'F1' || v === 'F2' || v === 'F3') return v;
    return null;
  } catch {
    return null;
  }
}

export function saveFormOverride(form: FormLevel): void {
  try {
    localStorage.setItem(FORM_OVERRIDE_KEY, form);
  } catch {
    /* ignore */
  }
}

export function loadCachedClassName(): string {
  try {
    return (localStorage.getItem(CLASS_CACHE_KEY) || '').trim();
  } catch {
    return '';
  }
}

export function saveCachedClassName(className: string): void {
  try {
    if (className) localStorage.setItem(CLASS_CACHE_KEY, className.trim());
  } catch {
    /* ignore */
  }
}

export interface ResolveFormOptions {
  overrideForm?: FormLevel | null;
  isTeacher?: boolean;
}

export function resolvePlayerForm(
  email: string,
  className?: string | null,
  opts: ResolveFormOptions = {},
): FormResolution {
  const cleanClass = (className || loadCachedClassName() || '').trim();
  const parsed = formFromClassName(cleanClass);

  if (parsed === 'SENIOR') {
    return {
      canPvp: false,
      form: null,
      isTeacher: false,
      className: cleanClass,
      reason: `目前班別（${cleanClass}）屬高中（中四至中六），雙人連線對戰只開放予初中（F1–F3）。你仍可選擇「對電腦」練習。`,
    };
  }

  const teacher = opts.isTeacher ?? isLikelyTeacherEmail(email);

  if (parsed === 'F1' || parsed === 'F2' || parsed === 'F3') {
    return {
      canPvp: true,
      form: parsed,
      isTeacher: teacher,
      className: cleanClass,
    };
  }

  const saved = opts.overrideForm ?? loadSavedFormOverride();
  if (saved) {
    return {
      canPvp: true,
      form: saved,
      isTeacher: teacher,
      className: cleanClass,
    };
  }

  if (teacher) {
    return {
      canPvp: true,
      form: 'F1',
      isTeacher: true,
      className: cleanClass || '老師（預設 F1）',
    };
  }

  if (cleanClass && !parsed) {
    return {
      canPvp: false,
      form: null,
      isTeacher: false,
      className: cleanClass,
      reason: `無法識別你的班別年級（${cleanClass}），請在上方選擇你的年級（F1／F2／F3），或使用「對電腦」模式。`,
    };
  }

  return {
    canPvp: true,
    form: 'F1',
    isTeacher: false,
    className: cleanClass,
  };
}
