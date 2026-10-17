// Read-only smoke against the reproducible demo fixture.
process.env.EXPORT_TRIAL_CODE ||= 'CT-DEMO-ELV-01';
process.env.EXPORT_DEVICE_PROJECT_CODE ||= process.env.EXPORT_TRIAL_CODE;
process.env.EXPORT_ACCEPTANCE_CODE ||= 'DEMO-AC-CONFIRMED-V1';
require('./exports.browser.cjs');
