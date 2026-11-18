/**
 * About to be removed: the Consumer / Editor switch is gone. Everyone sees the reader's pages;
 * what used to depend on the editor view now depends on the person's rights (`./rights`).
 * Kept only until the last pages stop calling it.
 * @deprecated use the rights in `./rights` instead
 */
export const useEditor = () => true;
