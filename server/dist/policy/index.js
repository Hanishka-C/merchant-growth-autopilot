"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeterministicPolicyEngine = void 0;
class DeterministicPolicyEngine {
    maxBudgetLimit = 5000000; // ₹50,000 in Paise
    maxDiscountPercentage = 25; // 25%
    maxDiscountAmountLimit = 50000; // ₹500 in Paise
    evaluate(action) {
        const rulesChecked = [];
        const violations = [];
        // Rule 1: Max Budget check (dynamic or fallback to hard limit)
        const activeLimit = action.maxBudget !== undefined ? action.maxBudget : this.maxBudgetLimit;
        const budgetPassed = action.budget <= activeLimit;
        rulesChecked.push({
            ruleName: 'MAX_CAMPAIGN_BUDGET',
            status: budgetPassed ? 'PASSED' : 'FAILED',
            limit: activeLimit,
            value: action.budget
        });
        if (!budgetPassed) {
            violations.push(`Campaign budget ₹${action.budget / 100} exceeds maximum limit of ₹${activeLimit / 100}.`);
        }
        // Rule 2: Max Discount Percentage Check
        const discountPercentage = action.parameters.discountPercentage || 0;
        const pctPassed = discountPercentage <= this.maxDiscountPercentage;
        rulesChecked.push({
            ruleName: 'MAX_DISCOUNT_PERCENT',
            status: pctPassed ? 'PASSED' : 'FAILED',
            limit: this.maxDiscountPercentage,
            value: discountPercentage
        });
        if (!pctPassed) {
            violations.push(`Discount percentage ${discountPercentage}% exceeds limit of ${this.maxDiscountPercentage}%.`);
        }
        // Rule 3: Max Discount Amount Check
        const discountAmount = action.parameters.maxDiscountAmount || 0;
        const amtPassed = discountAmount <= this.maxDiscountAmountLimit;
        rulesChecked.push({
            ruleName: 'MAX_DISCOUNT_AMOUNT',
            status: amtPassed ? 'PASSED' : 'FAILED',
            limit: this.maxDiscountAmountLimit,
            value: discountAmount
        });
        if (!amtPassed) {
            violations.push(`Maximum unit discount amount ₹${discountAmount / 100} exceeds limit of ₹${this.maxDiscountAmountLimit / 100}.`);
        }
        // Rule 4: Min Order Value Margin Floor Check
        const minOrderAmount = action.parameters.minOrderAmount || 0;
        const minOrderLimit = discountAmount * 3;
        const marginPassed = minOrderAmount >= minOrderLimit;
        rulesChecked.push({
            ruleName: 'MIN_AOV_FLOOR_FACTOR',
            status: marginPassed ? 'PASSED' : 'FAILED',
            limit: `minOrder >= 3 * unitDiscount (₹${minOrderLimit / 100})`,
            value: `minOrder: ₹${minOrderAmount / 100}, discount: ₹${discountAmount / 100}`
        });
        if (!marginPassed) {
            violations.push(`Minimum order floor constraint violated: Order value (₹${minOrderAmount / 100}) must be at least 3x the unit discount (₹${discountAmount / 100}).`);
        }
        const passed = violations.length === 0;
        return {
            passed,
            violations,
            rulesChecked
        };
    }
}
exports.DeterministicPolicyEngine = DeterministicPolicyEngine;
