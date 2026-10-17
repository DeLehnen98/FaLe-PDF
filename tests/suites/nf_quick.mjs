import { formatWithCode as F, fromGermanCode as G, toGermanCode as T, isDateFormat } from '/home/claude/FalePDF/js/office/numfmt.js';
const cases = [[1234.5,'#,##0.00'],[1200,'#,##0.00 "€"'],[0.256,'0.0%'],[0.12,'0%'],[-1234.5,'#,##0.00;[Red]-#,##0.00'],[46096,'dd.mm.yyyy'],[46096.5,'dd.mm.yyyy hh:mm'],[46096,'dddd, d. mmmm yyyy'],[46096,'mmm yy'],[0.75,'h:mm AM/PM'],[1.5,'[h]:mm'],[12345.678,'0.00E+00'],[0.5,'# ?/?'],[1.25,'# ?/4'],[0,'0;-0;"Null"'],[-5,'0;(0)'],['abc','0;0;0;"Text: "@'],[5,'00000'],[1234567,'#,##0,'],[49123456,'000-000-00'],[3.14159,'0.###'],[3,'0.###'],[1e20,'General'],[1/3,'General'],[-0.5,'0.00'],[150,'[>100]"groß";"klein"'],[50,'[>100]"groß";"klein"'],[46096.5208333,'hh:mm:ss'],[7,'@']];
for (const [v,c] of cases) console.log(JSON.stringify(c).padEnd(36), '=>', JSON.stringify(F(v,c)));
for (const g of ['#.##0,00 €','TT.MM.JJJJ','0,00','0,0 %','#,##0','#.##0','MMMM JJJJ','hh:mm','TTTT','0.00']) console.log(g, '->', G(g));
for (const c of ['#,##0.00 "€"','dd.mm.yyyy','dd.mm.yyyy hh:mm','0.00%']) console.log(c, '->', T(c));
console.log(isDateFormat('dd.mm.yyyy'), isDateFormat('#,##0.00 "€"'), isDateFormat('[h]:mm'));
