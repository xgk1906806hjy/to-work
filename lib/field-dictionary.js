/**
 * 校招常见字段：标签关键词 → 简历路径
 * 用于本地规则映射，LLM 失败或不配置时回退。
 */
const FIELD_DICTIONARY = [
  { keys: ["姓名", "名字", "中文名", "真实姓名"], path: "basic.name", type: "text" },
  { keys: ["英文名", "英语名", "拼音名", "英文姓名"], path: "basic.englishName", type: "text" },
  { keys: ["性别"], path: "basic.gender", type: "radio" },
  { keys: ["出生日期", "生日", "出生年月"], path: "basic.birthday", type: "date" },
  { keys: ["手机", "手机号", "手机号码", "联系电话", "电话"], path: "basic.phone", type: "text" },
  { keys: ["邮箱", "电子邮箱", "电子邮件", "Email", "E-mail"], path: "basic.email", type: "text" },
  { keys: ["证件类型", "证件类别", "身份证件类型"], path: "basic.idType", type: "select" },
  { keys: ["证件号码", "身份证号", "身份证号码", "证件号"], path: "basic.idNumber", type: "text" },
  { keys: ["民族"], path: "basic.ethnicity", type: "select" },
  { keys: ["政治面貌"], path: "basic.politicalStatus", type: "select" },
  { keys: ["入党", "入团", "入党/团", "入党团时间", "入党时间", "入团时间"], path: "basic.partyJoinDate", type: "date" },
  { keys: ["籍贯"], path: "basic.nativePlace", type: "text" },
  { keys: ["出生地"], path: "basic.birthPlace", type: "text" },
  { keys: ["国籍"], path: "basic.nationality", type: "select" },
  { keys: ["健康状况", "健康情况"], path: "basic.health", type: "select" },
  { keys: ["婚姻状况", "婚姻状态"], path: "basic.maritalStatus", type: "select" },
  { keys: ["身高"], path: "basic.height", type: "text" },
  { keys: ["体重"], path: "basic.weight", type: "text" },
  { keys: ["现居住地", "现居地", "当前城市", "所在城市", "居住城市"], path: "basic.currentCity", type: "text" },
  { keys: ["生源地"], path: "basic.sourcePlace", type: "text" },
  { keys: ["通讯地址", "联系地址", "家庭住址", "详细地址", "住址"], path: "basic.address", type: "text" },
  { keys: ["紧急联系人"], path: "basic.emergencyContact", type: "text" },
  { keys: ["紧急联系人电话", "紧急电话"], path: "basic.emergencyPhone", type: "text" },
  { keys: ["自我评价", "自我描述", "个人总结"], path: "selfEvaluation", type: "textarea" }
];

/**
 * @param {string} label
 * @returns {{ keys: string[], path: string, type: string } | null}
 */
function matchFieldByLabel(label) {
  if (!label) return null;
  const normalized = String(label).replace(/\s+/g, "").replace(/[*:：\s必填]/g, "");
  let best = null;
  let bestScore = 0;

  for (const entry of FIELD_DICTIONARY) {
    for (const key of entry.keys) {
      const k = key.replace(/\s+/g, "");
      if (normalized === k) {
        return entry;
      }
      if (normalized.includes(k) || k.includes(normalized)) {
        const score = Math.min(normalized.length, k.length) / Math.max(normalized.length, k.length);
        if (score > bestScore) {
          bestScore = score;
          best = entry;
        }
      }
    }
  }

  return bestScore >= 0.4 ? best : null;
}

/**
 * @param {object} resume
 * @param {string} path
 * @returns {string}
 */
function getResumeValue(resume, path) {
  if (!resume || !path) return "";
  const parts = path.split(".");
  let cur = resume;
  for (const part of parts) {
    if (cur == null) return "";
    cur = cur[part];
  }
  if (cur == null) return "";
  return String(cur);
}

if (typeof window !== "undefined") {
  window.CampusAutofill = window.CampusAutofill || {};
  window.CampusAutofill.FIELD_DICTIONARY = FIELD_DICTIONARY;
  window.CampusAutofill.matchFieldByLabel = matchFieldByLabel;
  window.CampusAutofill.getResumeValue = getResumeValue;
}
