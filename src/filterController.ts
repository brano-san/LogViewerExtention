let includeFilter: string | undefined;
let excludeFilter: string | undefined;

export const filterController = {
  setFilters: (inc?: string, exc?: string) => { includeFilter=inc; excludeFilter=exc; },
  getCurrentFilters: () => ({ include: includeFilter, exclude: excludeFilter })
};
