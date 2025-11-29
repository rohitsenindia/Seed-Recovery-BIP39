// This script runs in a separate thread from the main UI.

// --- Library Loading ---
try {
  // Use importScripts to load external libraries into the worker's scope.
  // These are fundamental for the cryptographic operations.
  self.importScripts("https://cdnjs.cloudflare.com/ajax/libs/ethers/5.7.2/ethers.umd.min.js");
  self.importScripts("https://unpkg.com/bip39@3.1.0/build/bip39.min.js");
} catch (e) {
  // If libraries fail to load, send an error back to the main thread.
  // This can happen due to network issues or ad-blockers interfering.
  self.postMessage({
    type: "ERROR",
    payload: "Failed to load crypto libraries in worker. Please check your internet connection or ad-blocker."
  });
  self.close(); // Close the worker if it cannot initialize.
}

// --- Global State ---
let wasPaused = false;
let shouldStop = false;
let currentIteration = 0;
let totalCombinations = 0;

// --- Main Message Handler ---
self.onmessage = function (event) {
  const { type, payload } = event.data;

  switch (type) {
    case "START":
      // Reset state for a new job
      wasPaused = false;
      shouldStop = false;
      currentIteration = 0;
      
      // Start the appropriate recovery process
      if (payload.mode === 'ordered') {
        findSeedOrdered(payload);
      } else {
        findSeedUnordered(payload);
      }
      break;
    case "PAUSE":
      wasPaused = true;
      break;
    case "RESUME":
      wasPaused = false;
      break;
    case "STOP":
      shouldStop = true;
      break;
  }
};

// --- Core Recovery Logic ---

/**
 * Checks if a given mnemonic phrase matches the target address.
 * @param {string} mnemonic - The seed phrase to test.
 * @param {object} config - The recovery configuration.
 * @returns {object|null} The successful result or null.
 */
function checkMnemonic(mnemonic, { targetAddress, derivationPath, childIndexes }) {
  if (!bip39.validateMnemonic(mnemonic)) {
    return null;
  }

  const masterNode = ethers.utils.HDNode.fromMnemonic(mnemonic);
  
  for (let i = 0; i < childIndexes; i++) {
    const childNode = masterNode.derivePath(`${derivationPath}/${i}`);
    if (childNode.address.toLowerCase() === targetAddress.toLowerCase()) {
      return {
        mnemonic: mnemonic,
        path: childNode.path,
        address: childNode.address,
      };
    }
  }
  return null;
}

/**
 * Handles the recovery process when the word order is known.
 */
async function findSeedOrdered({ words, missingIndexes, targetAddress, derivationPath, childIndexes }) {
  const wordlist = bip39.wordlists.english;
  totalCombinations = Math.pow(wordlist.length, missingIndexes.length);
  self.postMessage({ type: "STATUS_UPDATE", payload: 'running' });

  const config = { targetAddress, derivationPath, childIndexes };

  const startTime = Date.now();

  async function iterate(depth, currentWords) {
    if (shouldStop) return;

    if (depth === missingIndexes.length) {
      currentIteration++;
      const mnemonic = currentWords.join(" ");
      const result = checkMnemonic(mnemonic, config);
      if (result) {
        self.postMessage({ type: "FOUND", payload: result });
        shouldStop = true;
      }
      return;
    }

    for (let i = 0; i < wordlist.length; i++) {
        if (shouldStop) return;
        
        // Pause loop if requested
        while (wasPaused) {
            await new Promise(resolve => setTimeout(resolve, 500)); // Check every 500ms
            if (shouldStop) return;
        }

        const newWords = [...currentWords];
        newWords[missingIndexes[depth]] = wordlist[i];
        
        await iterate(depth + 1, newWords);

        if (currentIteration % 1000 === 0) { // Update progress periodically
            const eta = calculateETA(startTime, currentIteration, totalCombinations);
            self.postMessage({
                type: "PROGRESS",
                payload: {
                    attempts: currentIteration,
                    combinations: totalCombinations,
                    eta,
                    currentWords: [wordlist[i]]
                },
            });
        }
    }
  }

  await iterate(0, words);

  self.postMessage({ type: "DONE" });
  self.close();
}


/**
 * Handles the recovery process when word order is unknown.
 */
async function findSeedUnordered({ knownWords, wordCount, missingWordCount, targetAddress, derivationPath, childIndexes }) {
    const wordlist = bip39.wordlists.english;
    const config = { targetAddress, derivationPath, childIndexes };
    self.postMessage({ type: "STATUS_UPDATE", payload: 'running' });

    // 1. Find candidate missing words (words from BIP39 list not in knownWords)
    const knownWordsSet = new Set(knownWords);
    const candidateWords = wordlist.filter(w => !knownWordsSet.has(w));
    
    // 2. Get all combinations of missing words
    const missingWordCombinations = getCombinations(candidateWords, missingWordCount);
    
    totalCombinations = missingWordCombinations.length;

    const startTime = Date.now();

    for (let i = 0; i < missingWordCombinations.length; i++) {
        if (shouldStop) break;
        currentIteration = i + 1;

        while (wasPaused) {
            await new Promise(resolve => setTimeout(resolve, 500));
            if (shouldStop) break;
        }

        const potentialWords = [...knownWords, ...missingWordCombinations[i]];
        
        // Get all permutations of this set of words
        const permutations = getPermutations(potentialWords);

        for (const p of permutations) {
             if (shouldStop) break;
            const mnemonic = p.join(" ");
            const result = checkMnemonic(mnemonic, config);
            if (result) {
                self.postMessage({ type: "FOUND", payload: result });
                shouldStop = true;
                break;
            }
        }
        
        if (currentIteration % 10 === 0) { // Update less frequently for unordered due to nested loops
            const eta = calculateETA(startTime, currentIteration, totalCombinations);
            self.postMessage({
                type: "PROGRESS",
                payload: {
                    attempts: currentIteration,
                    combinations: totalCombinations,
                    eta: eta,
                    currentWords: missingWordCombinations[i]
                },
            });
        }
    }

    self.postMessage({ type: "DONE" });
    self.close();
}


// --- Utility Functions ---

function calculateETA(startTime, attempts, total) {
  if (attempts === 0) return "...";
  const elapsedTime = Date.now() - startTime;
  const avgTimePerAttempt = elapsedTime / attempts;
  const remainingAttempts = total - attempts;
  const remainingTime = remainingAttempts * avgTimePerAttempt;

  const seconds = Math.floor((remainingTime / 1000) % 60);
  const minutes = Math.floor((remainingTime / (1000 * 60)) % 60);
  const hours = Math.floor(remainingTime / (1000 * 60 * 60));

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

// Generate all combinations of a specific size from an array
function getCombinations(arr, size) {
    const result = [];
    function combo(index, current) {
        if (current.length === size) {
            result.push(current);
            return;
        }
        if (index === arr.length) {
            return;
        }
        // Include current element
        combo(index + 1, [...current, arr[index]]);
        // Don't include current element
        combo(index + 1, current);
    }
    combo(0, []);
    return result;
}

// Generate all permutations of an array
function getPermutations(arr) {
    const result = [];
    function permute(current, remaining) {
        if (remaining.length === 0) {
            result.push(current);
            return;
        }
        for (let i = 0; i < remaining.length; i++) {
            const nextCurrent = [...current, remaining[i]];
            const nextRemaining = [...remaining.slice(0, i), ...remaining.slice(i + 1)];
            permute(nextCurrent, nextRemaining);
        }
    }
    permute([], arr);
    return result;
}
