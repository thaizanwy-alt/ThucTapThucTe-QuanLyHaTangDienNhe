// Test-only XLSX reader; production exports never depend on this package.
const readXlsx = require('read-excel-file/node');

module.exports = async function readWorkbook(path) {
  const pages = await readXlsx(path);
  const worksheets = pages.map(({ sheet, data }) => ({
    name: sheet,
    rowCount: data.length,
    getRow(number) {
      const values = data[number - 1] || [];
      return { getCell(index) { const value = values[index - 1] ?? null; return { value, type: typeof value }; } };
    },
    getRows(start, count) {
      return Array.from({ length: count }, (_, index) => this.getRow(start + index));
    },
    getColumn(index) {
      return { values: [null, ...data.map(row => row[index - 1] ?? null)] };
    },
  }));
  return { worksheets, getWorksheet(name) { return worksheets.find(sheet => sheet.name === name); } };
};
