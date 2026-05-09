import type { MealPlanStyle } from './mealPlan';

export type { MealPlanStyle };

export type SimpleGroceryItem = {
  name: string;
  quantity: number;
  unit: 'lb' | 'oz' | 'count';
};

export type SimpleGroceryList = {
  protein: SimpleGroceryItem[];
  vegetables: SimpleGroceryItem[];
  pantry: SimpleGroceryItem[];
  others: SimpleGroceryItem[];
};

export type SimpleMealDay = {
  day: number;
  meal: string;
  description: string;
  protein: string;
  prepMinutes: number;
};

export type SimpleMealPlan = {
  days: SimpleMealDay[];
  groceryList: SimpleGroceryList;
};
