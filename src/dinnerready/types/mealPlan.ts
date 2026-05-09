export type MealPlanStyle = 'balanced' | 'healthy' | 'quick' | 'budget';

export type AppetiteLevel = 'light' | 'normal' | 'heavy';

export type GenerateMealPlanRequest = {
  people: number;
  style: MealPlanStyle;
  unitSystem?: 'imperial' | 'metric';
  locale?: string;
  preferredProteins?: string[];
  avoidedIngredients?: string[];
  proteinScores?: Record<string, number>;
  appetiteLevel?: AppetiteLevel;
  cuisinePreferences?: string[];
  cuisineStrength?: 'light' | 'moderate' | 'strong';
  // New fields
  country?: string;
  measurementUnits?: 'auto' | 'imperial' | 'metric';
  groceryStyle?: 'regular' | 'asian' | 'mixed';
  mealStyle?: 'Quick' | 'Balanced' | 'Comfort';
  varietyLevel?: 'Low' | 'Medium' | 'High';
  userPreferences?: {
    likedIngredients?: string[];
    dislikedIngredients?: string[];
    frequentlyReplaced?: string[];
    preferredCuisines?: string[];
  };
  dietaryPreferences?: string[];
  pantryStaples?: string[];
  /**
   * Optional RNG seed for the protein schedule.
   * Same seed → same schedule; omit for a fresh randomised schedule each time.
   */
  seed?: number;
};

export type MealIngredient = {
  name: string;
  quantity: number;
  unit: string;
};

export type MealMain = {
  name: string;
  servings: number;
  protein: string;
  ingredients: MealIngredient[];
};

export type MealSide = {
  name: string;
  optional: boolean;
};

export type MealDay = {
  day: 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';
  main: MealMain;
  side?: MealSide;
  steps: string[];
};

export type GroceryItem = {
  name: string;
  amount: string;
  usedIn: string[];
};

export type GroceryList = {
  'Produce 🥬': GroceryItem[];
  'Meat & Seafood 🥩': GroceryItem[];
  'Dairy & Eggs 🥚': GroceryItem[];
  'Pantry & Grains 🍞': GroceryItem[];
  'Frozen 🧊': GroceryItem[];
};

export type WeeklyMealPlan = {
  days: MealDay[];
  groceryList: GroceryList;
  meta: {
    style: MealPlanStyle;
    people: number;
    coreProteins: string[];
    coreProduce: string[];
    totalUniqueIngredients: number;
    estimatedCost: string;
    notes: string[];
  };
};
