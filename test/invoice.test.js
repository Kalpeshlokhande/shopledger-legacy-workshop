const test = require('node:test');
const assert = require('node:assert/strict');
const pricing = require('../lib/pricing');
const invoice = require('../lib/invoice');
const reports = require('../lib/reports');

// Keep the same monetary fields and item shape that POST /api/orders saves.
function billedOrder(items, coupon = '') {
  const { subtotal, discount, tax, total } = pricing.computeTotals(items, coupon);
  return { id: 1, items, coupon, subtotal, discount, tax, total };
}

test('An undiscounted item without an HSN uses the default GST rate', () => {
  const order = billedOrder([{ price: 100, qty: 1 }]);
  const printed = invoice.computeInvoiceFigures(order);
  assert.equal(printed.rows[0].gstPercent, 18);
  assert.equal(printed.tax, 18);
  assert.equal(printed.total, 118);
});

test('A recorded total discrepancy appears on the printed invoice', () => {
  const order = { items: [{ price: 100, qty: 1 }], total: 117 };
  assert.match(invoice.render(order), /recorded total \(₹117\.00\) by \+₹1\.00/);
});

test('Discounted rice invoice matches the GST and total billed at checkout', () => {
  const order = billedOrder([{ hsn: '1006', price: 640, qty: 1 }], 'SAVE10');
  const printed = invoice.computeInvoiceFigures(order);
  assert.deepEqual([order.tax, order.total], [28.8, 604.8]);
  assert.deepEqual([printed.tax, printed.total], [order.tax, order.total]);
});

test('Invoice splits an odd paisa of GST the same way as checkout', () => {
  const order = billedOrder([{ hsn: '0902', price: 100.05, qty: 1 }]);
  const printed = invoice.computeInvoiceFigures(order);
  assert.equal(order.tax, 18.01);
  assert.equal(order.total, 118.06);
  assert.equal(printed.total, order.total);
  assert.equal(printed.tax, order.tax);
  const checkout = pricing.computeTotals(order.items, order.coupon);
  assert.equal(checkout.cgst, 9.01);
  assert.equal(checkout.sgst, 9);
  assert.equal(printed.cgst, 9.01);
  assert.equal(printed.sgst, 9);
  assert.equal(reports.getGstReconciliation({ orders: [order] }).mismatchCount, 0);
});

test('Invoice prints the billed 5% rice and 12% butter rates', () => {
  const order = billedOrder([
    { name: 'Rice', hsn: '1006', price: 100, qty: 2 },
    { name: 'Butter', hsn: '0405', price: 50, qty: 1 }
  ]);
  assert.equal(order.tax, 16);
  assert.equal(order.total, 266);

  const printed = invoice.computeInvoiceFigures(order);
  assert.deepEqual(printed.rows.map(row => row.gstPercent), [5, 12]);
  assert.deepEqual(printed.rows.map(row => row.lineTax), [10, 6]);
  assert.equal(printed.tax, 16);
  assert.equal(printed.cgst, 8);
  assert.equal(printed.sgst, 8);
  assert.equal(printed.total, 266);

  const html = invoice.render(order);
  assert.match(html, /Total GST\)<\/td><td class="r">₹16\.00/);
  assert.match(html, /Invoice Total<\/td><td class="r">₹266\.00/);
  assert.doesNotMatch(html, /Accountant Reconciliation Notice/);
});

test('Invoice applies the ₹150 SAVE10 cap before GST', () => {
  const order = billedOrder([{ hsn: '0902', price: 1000, qty: 2 }], 'SAVE10');
  assert.equal(order.discount, 150);
  assert.equal(order.tax, 333);
  assert.equal(order.total, 2183);

  const printed = invoice.computeInvoiceFigures(order);
  assert.equal(printed.discount, 150);
  assert.equal(printed.tax, 333);
  assert.equal(printed.total, 2183);
});

test('Invoice applies FLAT50 before calculating GST', () => {
  const order = billedOrder([{ hsn: '0902', price: 300, qty: 1 }], 'FLAT50');
  assert.equal(order.discount, 50);
  assert.equal(order.tax, 45);
  assert.equal(order.total, 295);

  const printed = invoice.computeInvoiceFigures(order);
  assert.equal(printed.discount, 50);
  assert.equal(printed.tax, 45);
  assert.equal(printed.total, 295);
});

test('Reconciliation matches both tax and total for an uncapped discount', () => {
  const order = billedOrder([{ hsn: '0902', price: 500, qty: 1 }], 'SAVE10');
  const printed = invoice.computeInvoiceFigures(order);
  assert.equal(order.total, 531);
  assert.equal(printed.total, 531);
  assert.equal(order.tax, 81);
  assert.equal(printed.tax, 81);
  assert.doesNotMatch(invoice.render(order), /Accountant Reconciliation Notice/);

  const report = reports.getGstReconciliation({ orders: [order] });
  assert.equal(report.mismatchCount, 0);
  assert.equal(report.rows[0].matched, true);
  assert.equal(report.rows[0].delta, 0);
});

test('Invoice sums line taxes rounded to the paisa', () => {
  const order = billedOrder([
    { hsn: '0902', price: 0.03, qty: 1 },
    { hsn: '0901', price: 0.03, qty: 1 }
  ]);
  const printed = invoice.computeInvoiceFigures(order);
  assert.deepEqual(printed.rows.map(row => row.lineTax), [0.01, 0.01]);
  assert.equal(order.tax, 0.02);
  assert.equal(printed.tax, 0.02);
  assert.equal(order.total, 0.08);
  assert.equal(printed.total, 0.08);
});
