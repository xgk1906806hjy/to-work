/** @typedef {import('./types.js').ResumeData} ResumeData */

/** @type {ResumeData} */
const DEFAULT_RESUME = {
  basic: {
    name: "",
    englishName: "",
    gender: "",
    birthday: "",
    phone: "",
    email: "",
    idType: "身份证",
    idNumber: "",
    ethnicity: "汉族",
    politicalStatus: "",
    partyJoinDate: "",
    nativePlace: "",
    birthPlace: "",
    nationality: "中国",
    health: "健康",
    maritalStatus: "未婚",
    height: "",
    weight: "",
    currentCity: "",
    sourcePlace: "",
    address: "",
    emergencyContact: "",
    emergencyPhone: ""
  },
  education: [],
  internships: [],
  projects: [],
  skills: [],
  certificates: [],
  languages: [],
  selfEvaluation: ""
};

/**
 * @returns {ResumeData}
 */
function createEmptyResume() {
  return JSON.parse(JSON.stringify(DEFAULT_RESUME));
}

if (typeof window !== "undefined") {
  window.CampusAutofill = window.CampusAutofill || {};
  window.CampusAutofill.DEFAULT_RESUME = DEFAULT_RESUME;
  window.CampusAutofill.createEmptyResume = createEmptyResume;
}
