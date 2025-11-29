// This script runs in a separate thread and handles the heavy computation.
// It should not have any direct access to the DOM.

// Import necessary libraries. Using importScripts for web workers.
try {
  importScripts('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.7.2/ethers.umd.min.js');
  importScripts('https://cdnjs.cloudflare.com/ajax/libs/bip39/3.1.0/bip39.min.js');
} catch (e) {
  self.postMessage({ type: 'ERROR', payload: 'Failed to load crypto libraries in worker. Please check your internet connection or ad-blocker.' });
}


// --- Worker State ---
let wasStopped = false;
let isPaused = false;
const BIP39_WORDLIST = bip39.wordlists.english;
const BIP39_WORDLIST_LENGTH = BIP39_WORDLIST.length;

// --- Helper Functions ---
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const getFullDerivationPath = (basePath, index) => `${basePath}/${index}`;

async function checkCombination(mnemonic, targetAddress, basePath, childIndexes) {
  // BIP39 validation is crucial to avoid unnecessary computation.
  if (!bip39.validateMnemonic(mnemonic)) {
    return null;
  }

  // Derive seed from mnemonic. This is a computationally intensive step.
  const seed = await bip39.mnemonicToSeed(mnemonic);
  const masterNode = ethers.utils.HDNode.fromSeed(seed);

  // Check a range of addresses derived from this seed.
  for (let i = 0; i < childIndexes; i++) {
    // Check for stop/pause signals frequently to keep the worker responsive.
    if (wasStopped) return 'stopped';
    if (isPaused) {
      self.postMessage({ type: 'STATUS_UPDATE', payload: 'paused' });
      while(isPaused && !wasStopped) {
          await sleep(200);
      }
      self.postMessage({ type: 'STATUS_UPDATE', payload: 'running' });
    }

    const fullPath = getFullDerivationPath(basePath, i);
    const childNode = masterNode.derivePath(fullPath);
    
    // Compare derived address with the target.
    if (childNode.address.toLowerCase() === targetAddress.toLowerCase()) {
      return {
        mnemonic,
        path: fullPath,
        address: childNode.address,
      };
    }
  }

  return null;
}

// --- Main Worker Logic ---
self.onmessage = async (event) => {
  const { type, payload } = event.data;

  // --- Control Messages ---
  if (type === 'STOP') {
    wasStopped = true;
    return;
  }
  if (type === 'PAUSE') {
    isPaused = true;
    return;
  }
  if (type === 'RESUME') {
    isPaused = false;
    return;
  }

  // --- Start Brute-force ---
  if (type === 'START') {
    wasStopped = false;
    isPaused = false;

    const { words, missingIndexes, targetAddress, derivationPath, childIndexes } = payload;
    const numMissing = missingIndexes.length;

    if (numMissing === 0 || numMissing > 2) {
      self.postMessage({ type: 'ERROR', payload: `Invalid number of missing words: ${numMissing}` });
      return;
    }

    let attempts = 0;
    const totalCombinations = Math.pow(BIP39_WORDLIST_LENGTH, numMissing);
    const startTime = Date.now();
    
    const postProgress = (currentWords) => {
        const elapsedTime = (Date.now() - startTime) / 1000; // in seconds
        const rate = attempts / elapsedTime; // attempts per second
        const remaining = totalCombinations - attempts;
        const etaSeconds = rate > 0 ? remaining / rate : Infinity;
        const eta = isFinite(etaSeconds) ? new Date(etaSeconds * 1000).toISOString().substr(11, 8) : '...';

        self.postMessage({
            type: 'PROGRESS',
            payload: {
                attempts,
                combinations: totalCombinations,
                eta,
                currentWords,
            }
        });
    };

    // --- One Missing Word ---
    if (numMissing === 1) {
      for (let i = 0; i < BIP39_WORDLIST_LENGTH; i++) {
        if (wasStopped) break;

        const candidateWord = BIP39_WORDLIST[i];
        let mnemonicAttempt = [...words];
        mnemonicAttempt[missingIndexes[0]] = candidateWord;
        const mnemonicString = mnemonicAttempt.join(' ');
        
        const result = await checkCombination(mnemonicString, targetAddress, derivationPath, childIndexes);
        
        if (result === 'stopped') break;
        if (result) {
          self.postMessage({ type: 'FOUND', payload: result });
          wasStopped = true;
          break;
        }

        attempts++;
        if (attempts % 1000 === 0) { // Report progress periodically
            postProgress([candidateWord]);
        }
      }
    }

    // --- Two Missing Words ---
    if (numMissing === 2) {
      for (let i = 0; i < BIP39_WORDLIST_LENGTH; i++) {
        if (wasStopped) break;
        const word1 = BIP39_WORDLIST[i];

        for (let j = 0; j < BIP39_WORDLIST_LENGTH; j++) {
          if (wasStopped) break;
          const word2 = BIP39_WORDLIST[j];

          let mnemonicAttempt = [...words];
          mnemonicAttempt[missingIndexes[0]] = word1;
          mnemonicAttempt[missingIndexes[1]] = word2;
          const mnemonicString = mnemonicAttempt.join(' ');

          const result = await checkCombination(mnemonicString, targetAddress, derivationPath, childIndexes);

          if (result === 'stopped') break;
          if (result) {
            self.postMessage({ type: 'FOUND', payload: result });
            wasStopped = true;
            break;
          }

          attempts++;
          if (attempts % 50000 === 0) { // Report progress less frequently for 2-word search
             postProgress([word1, word2]);
          }
        }
      }
    }
    
    if (!wasStopped) {
      self.postMessage({ type: 'DONE' });
    } else {
      self.postMessage({ type: 'STATUS_UPDATE', payload: 'stopped' });
    }
  }
};
