import { canUseProFeature, freeBillingStatus, getPlanAction, proBillingStatus } from './billing'

export function billingGateTestMatrix() {
  return {
    freePdf: canUseProFeature(freeBillingStatus, 'pdfExport'),
    proPdf: canUseProFeature(proBillingStatus, 'pdfExport'),
    teamDisabled: getPlanAction('team').disabled === true,
    enterpriseContactOnly: getPlanAction('enterprise').href.startsWith('mailto:'),
  }
}
