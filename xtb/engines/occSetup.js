import { atomicNumbersOf, buildMolecule, readCoordinates, } from "./occGeometry.js";
import { describeOccError } from "./occModule.js";
/**
 * Build a centred molecule and a converged GFN2 calculator on it, with the
 * request's charge and unpaired electrons applied.
 *
 * `charge` and `numUnpairedElectrons` are accessor properties on
 * `XtbCalculator`, so assigning them before the first SCF is what changes the
 * physics: OH⁻ at charge −1 gives −4.68161154752 Eh against −4.44320561238 Eh
 * for the neutral radical.
 * @param module - The loaded occjs module.
 * @param geometry - Elements and Cartesian coordinates in Å.
 * @param settings - Charge and spin; the rest is ignored here.
 * @param scope - Scope owning the molecule and the calculator.
 * @returns The prepared system.
 * @throws When the electron count and the unpaired-electron count disagree in
 * parity, or when the SCF fails.
 */
export function prepareSystem(module, geometry, settings, scope) {
    const atomicNumbers = atomicNumbersOf(module, geometry.elements);
    const molecule = buildMolecule(module, atomicNumbers, geometry.coordinates, scope);
    const atoms = atomicNumbers.length;
    const calculator = scope.keep(module.XtbCalculator.fromMolecule(molecule));
    calculator.charge = settings.charge;
    calculator.numUnpairedElectrons = settings.unpairedElectrons;
    try {
        calculator.singlePoint();
    }
    catch (error) {
        throw new Error(describeOccError(module, error), { cause: error });
    }
    const electronic = readElectronicResult(calculator);
    const warnings = [];
    const isUnrestricted = calculator.isUnrestricted();
    if (settings.unpairedElectrons > 0 && !isUnrestricted) {
        warnings.push(`${settings.unpairedElectrons} unpaired electron(s) were requested but occ ran a spin-restricted SCF, so the result describes a closed shell.`);
    }
    if (isUnrestricted) {
        warnings.push('Open-shell GFN2: occ runs a spin-polarized SCF with its own spin constants, which is not what xtb --uhf does, so frequencies may differ from a native xtb reference by more than the closed-shell tolerance.');
    }
    return {
        electronic,
        molecule,
        calculator,
        atoms,
        coordinates: readAngstromCoordinates(molecule, atoms, scope),
        energy: {
            total: calculator.totalEnergy(),
            scc: calculator.sccEnergy(),
            repulsion: calculator.repulsionEnergy(),
            dispersion: calculator.dispersionEnergy(),
        },
        isUnrestricted,
        spinEnergy: calculator.spinEnergy(),
        warnings,
    };
}
/** The molecule's own coordinates, i.e. after centring, in Å. */
function readAngstromCoordinates(molecule, atoms, scope) {
    return readCoordinates(scope.keep(molecule.positions()), atoms);
}
//# sourceMappingURL=occSetup.js.map
export function readElectronicResult(calculator) {
    const result = calculator.lastResult();
    try {
        if (!result.converged) {
            const error = new Error(`SCC did not converge (${result.nIterations} iterations)`);
            error.sccIterations = result.nIterations;
            throw error;
        }
        return result.nIterations;
    } finally {
        result.delete();
    }
}
