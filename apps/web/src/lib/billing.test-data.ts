import { canUseProFeature, freeBillingStatus, getPlanAction, proBillingStatus } from './billing'

export function billingGateTestMatrix() {
  return {
    freePdf: canUseProFeature(freeBillingStatus, 'pdfExport'),
    proPdf: canUseProFeature(proBillingStatus, 'pdfExport'),
    teamContactOnly: getPlanAction('team').href.startsWith('mailto:') && getPlanAction('team').disabled !== true,
    enterpriseContactOnly: getPlanAction('enterprise').href.startsWith('mailto:'),
  }
}
