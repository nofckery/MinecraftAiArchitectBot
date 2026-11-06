const fs = require('fs');
const path = require('path');

const htmlPath = path.resolve('src/web/public/index.html');
const cssPath = path.resolve('src/web/public/style.css');

const html = fs.readFileSync(htmlPath, 'utf-8');
const css = fs.readFileSync(cssPath, 'utf-8');

console.log('=== ADVERSARIAL CSS & HTML SPECIFICITY PROBE ===\n');

// 1. Buttons without padding
console.log('--- 1. Buttons with .btn but NO explicit size modifier ---');
const btnRegex = /<button[^>]+class="([^"]+)"[^>]*>/g;
let m;
const unpadded = [];
const sizeClasses = ['btn-large', 'btn--lg', 'btn-sm', 'btn--sm', 'btn-micro', 'btn--micro', 'btn-bot-master', 'btn-bot-power', 'btn-facing', 'btn-handoff', 'btn-swap', 'btn-gamemode-exit', 'tool-btn', 'tab-btn', 'theme-btn'];

while ((m = btnRegex.exec(html)) !== null) {
  const cls = m[1];
  const full = m[0];
  if (cls.includes('btn') && !sizeClasses.some(s => cls.includes(s))) {
    unpadded.push({ cls, tag: full.replace(/\s+/g, ' ').substring(0, 90) });
  }
}
console.log(`Found ${unpadded.length} buttons that have .btn but NO size class:`);
unpadded.forEach(u => console.log(`  [${u.cls}] -> ${u.tag}`));

// 2. Specificity calculation for .form-group input vs .input-lg
console.log('\n--- 2. Form Input Specificity Collision ---');
const fgInputMatch = css.match(/\.form-group\s+input\[type="text"\]/);
const inputLgMatch = css.match(/\.input-lg/);
console.log('.form-group input[type="text"] present:', !!fgInputMatch);
console.log('.input-lg present:', !!inputLgMatch);

// In CSS:
// .form-group input[type="text"] => (0, 2, 1) = specificity 21
// .input-lg => (0, 1, 0) = specificity 10
// When inside .form-group, .form-group input[type="text"] overrides .input-lg font-size and padding.
const inputLgElements = [];
const inpReg = /<input[^>]+class="[^"]*input-lg[^"]*"[^>]*>/g;
while ((m = inpReg.exec(html)) !== null) {
  inputLgElements.push(m[0].replace(/\s+/g, ' ').substring(0, 80));
}
console.log(`Elements in index.html with class="input-lg": ${inputLgElements.length}`);
inputLgElements.forEach(el => console.log('  ' + el));

// 3. Extraneous !important count
console.log('\n--- 3. !important Count & Contracts ---');
const importantMatches = [];
const importantRegex = /([^{};]+:[^{};]+!important[^{};]*;)/gi;
while ((m = importantRegex.exec(css)) !== null) {
  importantMatches.push(m[1].trim());
}
console.log(`Total !important declarations in style.css: ${importantMatches.length}`);
importantMatches.forEach((imp, i) => console.log(`  ${i+1}. ${imp}`));

// 4. Check .hidden rules and coverage
console.log('\n--- 4. Hidden State Coverage ---');
const hiddenBlockMatch = css.match(/\/\* =+ *\r?\n\s*18\.\s*CASCADE SPECIFICITY: UNIFIED VISIBILITY[^\}]+\}/s);
if (hiddenBlockMatch) {
  console.log('Section 18 block found:');
  console.log(hiddenBlockMatch[0].substring(0, 300) + '...');
}
