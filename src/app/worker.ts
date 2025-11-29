/// <reference lib="webworker" />

import { HDNode, getAddress } from "ethers/lib/utils";
import {
  generateMnemonic,
  mnemonicToSeedSync,
  validateMnemonic,
  wordlists,
} from "bip39";

let wasm: any;

// --- Worker State ---
let status = "idle"; // idle, running, paused
let attempts = 0;
let combinations = 0;
let lastProgressTime = 0;

// --- Crypto Functions ---
// These are simplified versions that will be replaced by the real libraries.
const ethers = {
  utils: {
    HDNode,
    getAddress,
  },
};
const bip39 = {
  generateMnemonic,
  mnemonicToSeedSync,
  validateMnemonic,
  wordlists: {
      english: wordlists.english
  }
};


// --- Utility Functions ---
function post(type: string, payload?: any) {
  self.postMessage({ type, payload });
}

function getDerivedAddresses(
  mnemonic: string,
  basePath: string,
  count: number
): { path: string; address: string }[] {
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const masterNode = ethers.utils.HDNode.fromSeed(seed);
  const addresses = [];
  for (let i = 0; i < count; i++) {
    const childNode = masterNode.derivePath(`${basePath}/${i}`);
    addresses.push({
      path: childNode.path,
      address: childNode.address,
    });
  }
  return addresses;
}


function* permute(permutation: string[]): Generator<string[], void, void> {
    const length = permutation.length;
    const c = Array(length).fill(0);
    let i = 1;

    yield permutation.slice();

    while (i < length) {
        if (c[i] < i) {
            const k = i % 2 && c[i];
            const p = permutation[i];
            permutation[i] = permutation[k!];
            permutation[k!] = p;
            ++c[i];
            i = 1;
            yield permutation.slice();
        } else {
            c[i] = 0;
            ++i;
        }
    }
}


function* getCombinations(arr: string[], k: number): Generator<string[], void, void> {
    if (k === 0) {
        yield [];
        return;
    }
    if (k > arr.length) {
        return;
    }
    const first = arr[0];
    const rest = arr.slice(1);

    for (const combination of getCombinations(rest, k - 1)) {
        yield [first, ...combination];
    }
    for (const combination of getCombinations(rest, k)) {
        yield combination;
    }
}


async function checkMnemonic(mnemonic: string, targetAddress: string, derivationPath: string, childIndexes: number) {
  if (status !== 'running') return null;

  attempts++;
  const now = Date.now();
  if (now - lastProgressTime > 100) { // Update progress every 100ms
    const etaSeconds = combinations > 0 ? Math.round(((combinations - attempts) / (attempts / ((now - startTime) / 1000)))) : 0;
    const eta = attempts > 100 ? new Date(etaSeconds * 1000).toISOString().substr(11, 8) : "...";

    post("PROGRESS", {
      attempts,
      combinations,
      eta,
      currentWords: mnemonic.split(' ').slice(0, 4)
    });
    lastProgressTime = now;
  }

  if (bip39.validateMnemonic(mnemonic)) {
    const derivedAddresses = getDerivedAddresses(
      mnemonic,
      derivationPath,
      childIndexes
    );
    for (const derived of derivedAddresses) {
      if (derived.address.toLowerCase() === targetAddress.toLowerCase()) {
        return {
          mnemonic,
          path: derived.path,
          address: derived.address,
        };
      }
    }
  }
  return null;
}

// --- Main Worker Logic ---
let startTime = 0;

async function runOrderedSearch(payload: any) {
  const { words, missingIndexes, targetAddress, derivationPath, childIndexes } = payload;
  const wordlist = bip39.wordlists.english;
  combinations = Math.pow(wordlist.length, missingIndexes.length);
  attempts = 0;
  startTime = Date.now();
  
  if (missingIndexes.length === 1) {
    const missingIndex = missingIndexes[0];
    for (const word of wordlist) {
      if (status !== "running") break;
      const tempWords = [...words];
      tempWords[missingIndex] = word;
      const mnemonic = tempWords.join(" ");
      const found = await checkMnemonic(mnemonic, targetAddress, derivationPath, childIndexes);
      if (found) {
        post("FOUND", found);
        status = 'found';
        return;
      }
    }
  } else if (missingIndexes.length === 2) {
    const [idx1, idx2] = missingIndexes;
    for (const word1 of wordlist) {
      if (status !== "running") break;
      for (const word2 of wordlist) {
        if (status !== "running") break;
        const tempWords = [...words];
        tempWords[idx1] = word1;
        tempWords[idx2] = word2;
        const mnemonic = tempWords.join(" ");
        const found = await checkMnemonic(mnemonic, targetAddress, derivationPath, childIndexes);
        if (found) {
          post("FOUND", found);
          status = 'found';
          return;
        }
      }
    }
  }
}

async function runUnorderedSearch(payload: any) {
    const { knownWords, wordCount, missingWordCount, targetAddress, derivationPath, childIndexes } = payload;
    const wordlist = bip39.wordlists.english;

    // Filter out known words from the main wordlist
    const searchWordlist = wordlist.filter(w => !knownWords.includes(w));
    
    // Calculate total combinations
    let missingWordCombinations = 1;
    for(let i = 0; i < missingWordCount; i++) {
        missingWordCombinations *= (searchWordlist.length - i);
    }
    missingWordCombinations /= Array.from({length: missingWordCount}, (_, i) => i + 1).reduce((a, b) => a * b, 1);
    
    let permutationsOfTotal = 1;
    for(let i=1; i<=wordCount; i++) {
        permutationsOfTotal *= i;
    }
    combinations = missingWordCombinations * permutationsOfTotal;
    
    attempts = 0;
    startTime = Date.now();

    for (const missing of getCombinations(searchWordlist, missingWordCount)) {
        if (status !== 'running') break;

        const combinedWords = [...knownWords, ...missing];
        
        for(const p of permute(combinedWords)) {
            if (status !== 'running') break;
            const mnemonic = p.join(' ');
            const found = await checkMnemonic(mnemonic, targetAddress, derivationPath, childIndexes);
            if(found) {
                post("FOUND", found);
                status = 'found';
                return;
            }
        }
    }
}


self.onmessage = async (event) => {
  const { type, payload } = event.data;

  switch (type) {
    case "START":
      if (status === "running") return;
      status = "running";
      post("STATUS_UPDATE", "running");
      
      try {
        if (payload.mode === 'ordered') {
            await runOrderedSearch(payload);
        } else {
            await runUnorderedSearch(payload);
        }
      } catch (e: any) {
        post("ERROR", e.message || "An unknown error occurred in the worker.");
        status = "error";
      }

      if (status === 'running') {
         post("DONE", null);
         status = "done";
      }
      break;
    case "PAUSE":
      if (status === "running") status = "paused";
      post("STATUS_UPDATE", "paused");
      break;
    case "RESUME":
      if (status === "paused") status = "running";
      post("STATUS_UPDATE", "running");
      break;
    case "STOP":
      status = "stopped";
      post("STATUS_UPDATE", "stopped");
      break;
  }
};
