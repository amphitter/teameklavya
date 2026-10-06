"use client";

import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";

type Theme = "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  // SSR-stable initial value — the persisted/system theme is adopted AFTER
  // hydration. Reading localStorage during the first render makes server
  // HTML ≠ client HTML (hydration mismatch: Moon vs Sun icon, aria-label…).
  const [theme, setThemeState] = useState<Theme>("light");
  const hydratedRef = useRef(false);

  // Adopt the stored/system theme once, after mount. The inline pre-paint
  // script in app/layout.tsx has already set the correct class on <html>.
  useEffect(() => {
    const stored = localStorage.getItem("theme");
    const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const initial: Theme =
      stored === "dark" || stored === "light" ? stored : systemDark ? "dark" : "light";
    hydratedRef.current = true;
    if (initial !== theme) setThemeState(initial);
    // keep the class in sync even when the adopted theme equals the default
    document.documentElement.classList.toggle("dark", initial === "dark");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist + apply on every theme change AFTER adoption — the first pass
  // must not clobber the pre-paint state written by the inline script.
  useEffect(() => {
    if (!hydratedRef.current) return;
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("theme", theme);
  }, [theme]);

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
  };

  const toggleTheme = () => {
    setThemeState((prev) => (prev === "light" ? "dark" : "light"));
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
};
