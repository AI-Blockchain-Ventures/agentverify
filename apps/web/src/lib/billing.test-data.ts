import { canUseProFeature, freeBillingStatus, getPlanAction, proBillingStatus } from './billing'

export function billingGateTestMatrix() {
  return {
    freePdf: canUseProFeature(freeBillingStatus, 'pdfExport'),
    proPdf: canUseProFeature(proBillingStatus, 'pdfExport'),
    freeShare: canUseProFeature(freeBillingStatus, 'reportSharing'),
    proShare: canUseProFeature(proBillingStatus, 'reportSharing'),
    teamDisabled: getPlanAction('team').disabled === true,
    enterpriseContactOnly: getPlanAction('enterprise').href.startsWith('mailto:'),
  }
}
