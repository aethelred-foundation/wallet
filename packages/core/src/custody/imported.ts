export { LocalCustodyBackend as ImportedCustodyBackend } from "./local";

// The imported custody backend reuses LocalCustodyBackend since both store
// keys in encrypted local storage. The distinction is tracked in KeySlot.origin
// ("imported" vs "generated" vs "derived"). A separate backend class can be
// introduced if imported keys need different lifecycle or storage semantics.
