/** Default settings: neutral, closed shell, relaxed, at 298.15 K. */
export const DEFAULT_SETTINGS = {
    method: 'GFN2',
    charge: 0,
    unpairedElectrons: 0,
    optimize: true,
    maxCycles: 250,
    temperature: 298.15,
    pressure: 101_325,
    symmetryNumber: null,
};
/** Default outputs: everything the browser engine can produce cheaply. */
export const DEFAULT_OUTPUTS = {
    ir: true,
    raman: true,
    thermochemistry: true,
};
//# sourceMappingURL=calculation.js.map