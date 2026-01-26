const uzRegions = [
  { label: "Toshkent shahri", value: "tashkent_city" },
  { label: "Toshkent viloyati", value: "tashkent_region" },
  { label: "Andijon viloyati", value: "andijan" },
  { label: "Farg‘ona viloyati", value: "fergana" },
  { label: "Namangan viloyati", value: "namangan" },
  { label: "Samarqand viloyati", value: "samarkand" },
  { label: "Buxoro viloyati", value: "bukhara" },
  { label: "Xorazm viloyati", value: "khorezm" },
  { label: "Navoiy viloyati", value: "navoiy" },
  { label: "Qashqadaryo viloyati", value: "kashkadarya" },
  { label: "Surxondaryo viloyati", value: "surkhandarya" },
  { label: "Jizzax viloyati", value: "jizzakh" },
  { label: "Sirdaryo viloyati", value: "syrdarya" },
  { label: "Qoraqalpog‘iston Respublikasi", value: "karakalpakstan" },
];

const getRegionLabel = (country, regionValue) => {
  if (country !== "uzbekistan") return regionValue;

  const region = uzRegions.find((r) => r.value === regionValue);
  return region ? region.label : regionValue;
};

const formatDate = (dateStr) => {
  const d = new Date(dateStr);
  return d.toLocaleDateString("uz-UZ"); // 27.11.2025 formatda qaytaradi
};

const formatedDate = (dateStr) => {
  if (!dateStr) return "";

  // "28/11/2025" → [28, 11, 2025]
  const [day, month, year] = dateStr.split("/");

  return `${day}.${month}.${year}`;
};


module.exports = { getRegionLabel, formatDate, formatedDate };
