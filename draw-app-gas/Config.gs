/**
 * 中史無雙陀螺 · 抽卡 App（GAS）
 * VERSION: draw-app-gas 0.4.8
 *
 * 同一 Flash Card Spreadsheet（唔另開簿）
 */
var VERSION = 'draw-app-gas 0.4.8';

/** Flash Card 簿 ID（學習記錄／學生名單／抽卡記錄／擁有卡） */
var SPREADSHEET_ID = '1vZpNVqC_JyyFIFHjzV5SdoV9--lj8wx5mZMhg6CPotc';

var SHEET_STUDY = '學習記錄';
var SHEET_ROSTER = '學生名單';
var SHEET_DRAW_LOG = '抽卡記錄';
var SHEET_OWNED = '擁有卡';

/** 每日最多入帳 60 分鐘；每 10 分鐘＝1 抽 */
var SECONDS_PER_DAY_CAP = 3600;
var SECONDS_PER_DRAW = 600;

/** 稀有權重（Marcus／經理 2026-10-14） */
var RARITY_WEIGHT = {
  '普通': 4,
  '優秀': 2,
  '史詩': 0.7,
  '傳說': 0.22
};
var UNOWNED_MULT = 3;

/**
 * 無學習記錄時是否用 mock 時數（預覽／試抽）。
 * 正式課室接真 Sheet 後改 false。
 */
var ALLOW_MOCK_STUDY = true;

/** mock：兩日共約 6000 秒 → 入帳後 floor → 約 10 抽額度 */
var MOCK_STUDY_TEMPLATE = [
  { recordedAt: '2026-10-01T10:00:00+08:00', validSeconds: 5000 },
  { recordedAt: '2026-10-02T10:00:00+08:00', validSeconds: 1000 }
];
