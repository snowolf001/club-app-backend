export type Platform = 'ios' | 'android';
export type PlanCycle = 'monthly' | 'yearly';

export const IAP_PRODUCTS: Record<Platform, Record<PlanCycle, string>> = {
  ios: {
    // 以后 iOS 再单独改
    monthly: 'passeo_pro_monthly',
    yearly: 'passeo_pro_yearly',
  },
  android: {
    monthly: 'passeo_pro_monthly',
    yearly: 'passeo_pro_yearly',
  },
};

const PRODUCT_TO_CYCLE: Record<string, PlanCycle> = {
  passeo_pro_monthly: 'monthly',
  passeo_pro_yearly: 'yearly',
};

export function getPlanCycleFromProductId(productId: string): PlanCycle | null {
  return PRODUCT_TO_CYCLE[productId] ?? null;
}
