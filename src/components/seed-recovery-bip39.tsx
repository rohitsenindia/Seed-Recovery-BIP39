"use client";

import * as React from "react";
import { ethers } from "ethers";
import { generateMnemonic, wordlists } from "bip39";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Download,
  FileWarning,
  HelpCircle,
  KeyRound,
  Loader2,
  Pause,
  Play,
  ShieldAlert,
  StopCircle,
  TestTube2,
  X,
} from "lucide-react";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

// --- Type Definitions ---
type Status = "idle" | "running" | "paused" | "stopped" | "found" | "error" | "done";
type WorkerMessage = {
  type: "PROGRESS" | "FOUND" | "ERROR" | "STATUS_UPDATE" | "DONE";
  payload?: any;
};
type RecoveryMode = "ordered" | "unordered";


const DEFAULT_DERIVATION_PATH = "m/44'/60'/0'/0";

export default function SeedRecoveryBIP39() {
  // --- State Management ---
  const [wordCount, setWordCount] = React.useState<12 | 24>(12);
  const [words, setWords] = React.useState<string[]>(Array(12).fill(""));
  const [knownWords, setKnownWords] = React.useState("");
  const [missingWordCount, setMissingWordCount] = React.useState<number>(1);
  const [recoveryMode, setRecoveryMode] = React.useState<RecoveryMode>("ordered");
  const [targetAddress, setTargetAddress] = React.useState("");
  const [derivationPath, setDerivationPath] = React.useState(DEFAULT_DERIVATION_PATH);
  const [childIndexes, setChildIndexes] = React.useState(30);
  const [isConfirmed, setIsConfirmed] = React.useState(false);
  
  const [status, setStatus] = React.useState<Status>("idle");
  const [progress, setProgress] = React.useState({ attempts: 0, combinations: 0, eta: "...", currentWords: [] });
  const [result, setResult] = React.useState<{ mnemonic: string; path: string; address: string } | null>(null);
  const [logs, setLogs] = React.useState<string[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  const [showFullMnemonicWarning, setShowFullMnemonicWarning] = React.useState(false);
  const workerRef = React.useRef<Worker | null>(null);
  const { toast } = useToast();

  // --- Effects ---

  // Initialize and terminate web worker
  React.useEffect(() => {
    // Check for web worker compatibility
    if (typeof Worker === "undefined") {
      const errorMessage = "Web Workers are not supported in your browser. This tool cannot run securely.";
      setError(errorMessage);
      addLog(errorMessage, "error");
      return;
    }
    
    // Use the bundled worker from Next.js
    workerRef.current = new Worker(new URL('../app/worker.ts', import.meta.url));
    workerRef.current.onmessage = handleWorkerMessage;
    
    // Cleanup function
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  // Update word inputs when word count changes
  React.useEffect(() => {
    setWords(Array(wordCount).fill(""));
    setResult(null);
    setStatus('idle');
  }, [wordCount]);

  // Monitor for full seed phrase pasting
  React.useEffect(() => {
    if (recoveryMode === 'ordered') {
        const filledWords = words.filter(w => w.trim() !== "" && w.trim() !== "????");
        if (filledWords.length === wordCount) {
          setShowFullMnemonicWarning(true);
        }
    } else {
        const pastedWords = knownWords.split(/\s+/).filter(Boolean);
        if (pastedWords.length + missingWordCount === wordCount) {
             setShowFullMnemonicWarning(true);
        }
    }
  }, [words, wordCount, recoveryMode, knownWords, missingWordCount]);

  // --- Worker Communication ---
  const postToWorker = (type: string, payload?: any) => {
    workerRef.current?.postMessage({ type, payload });
  };

  const handleWorkerMessage = (event: MessageEvent<WorkerMessage>) => {
    const { type, payload } = event.data;
    switch (type) {
      case "PROGRESS":
        setProgress(payload);
        break;
      case "FOUND":
        setResult(payload);
        setStatus("found");
        addLog(`SUCCESS: Found matching mnemonic!`, "success");
        addLog(`Mnemonic: ${payload.mnemonic}`);
        addLog(`Path: ${payload.path}, Address: ${payload.address}`);
        break;
      case "ERROR":
        setError(payload);
        setStatus("error");
        addLog(`ERROR: ${payload}`, "error");
        break;
      case "STATUS_UPDATE":
        setStatus(payload);
        break;
      case "DONE":
        if (status !== 'found') {
            setStatus("done");
            addLog("Process finished. No match found.", "info");
        }
        break;
    }
  };
  
  // --- Event Handlers ---
  const handleWordChange = (index: number, value: string) => {
    // Allow pasting a full seed phrase
    const pastedWords = value.split(/\s+/).filter(Boolean);
    if (pastedWords.length > 1 && pastedWords.length <= wordCount) {
      const newWords = [...words];
      for (let i = 0; i < pastedWords.length; i++) {
        if (index + i < wordCount) {
          newWords[index + i] = pastedWords[i];
        }
      }
      setWords(newWords);
    } else {
      const newWords = [...words];
      newWords[index] = value;
      setWords(newWords);
    }
  };

  const handleStart = () => {
    setError(null);
    setResult(null);
    setLogs([]);

    // --- Input Validation ---
    if (!ethers.utils.isAddress(targetAddress)) {
      const msg = "Invalid Ethereum address.";
      setError(msg);
      addLog(msg, "error");
      return;
    }

    let workerPayload: any;

    if (recoveryMode === 'ordered') {
      const missingIndexes = words.map((w, i) => (w.trim() === "" || w.trim() === "????") ? i : -1).filter(i => i !== -1);
      if (missingIndexes.length === 0) {
        const msg = "Please leave at least one word blank to search for.";
        setError(msg);
        addLog(msg, "error");
        return;
      }
      if (missingIndexes.length > 2) {
        const msg = "This tool supports finding a maximum of two missing words in ordered mode.";
        setError(msg);
        addLog(msg, "error");
        return;
      }
      addLog(`Starting 'ordered' recovery for ${missingIndexes.length} missing word(s)...`, "info");
      workerPayload = {
        words,
        missingIndexes,
        mode: 'ordered'
      };
    } else { // unordered
        const knownWordsList = knownWords.split(/\s+/).filter(Boolean);
        const totalWords = knownWordsList.length + missingWordCount;
        if (totalWords !== wordCount) {
            const msg = `The number of known words (${knownWordsList.length}) + missing words (${missingWordCount}) must equal the seed phrase length (${wordCount}).`;
            setError(msg);
            addLog(msg, "error");
            return;
        }
        if (missingWordCount < 1) {
            const msg = "You must have at least one missing word.";
            setError(msg);
            addLog(msg, "error");
            return;
        }
        if (missingWordCount > 2) {
            const msg = "This tool supports a maximum of two missing words in unordered mode.";
            setError(msg);
            addLog(msg, "error");
            return;
        }
        addLog(`Starting 'unordered' recovery for ${missingWordCount} missing word(s)...`, "info");
        workerPayload = {
            knownWords: knownWordsList,
            wordCount,
            missingWordCount,
            mode: 'unordered'
        };
    }

    addLog(`Target Address: ${targetAddress}`);
    addLog(`Derivation Path Base: ${derivationPath}`);
    addLog(`Addresses to Check per Seed: ${childIndexes}`);

    setStatus("running");
    postToWorker("START", {
      ...workerPayload,
      targetAddress,
      derivationPath,
      childIndexes,
    });
  };

  const handlePause = () => {
    if (status === "running") {
      postToWorker("PAUSE");
      setStatus("paused");
      addLog("Search paused.", "info");
    }
  };

  const handleResume = () => {
    if (status === "paused") {
      postToWorker("RESUME");
      setStatus("running");
      addLog("Search resumed.", "info");
    }
  };
  
  const handleStop = () => {
    postToWorker("STOP");
    setStatus("stopped");
    addLog("Search stopped by user.", "info");
  };

  const handleRunTest = () => {
    // This generates a temporary, non-sensitive mnemonic for testing purposes.
    const tempMnemonic = generateMnemonic(128, undefined, wordlists.english);
    const wallet = ethers.Wallet.fromMnemonic(tempMnemonic, `${DEFAULT_DERIVATION_PATH}/0`);
    
    const testWords = tempMnemonic.split(" ");
    
    if (recoveryMode === 'ordered') {
        const missingIndex = Math.floor(Math.random() * 12);
        const missingWord = testWords[missingIndex];
        testWords[missingIndex] = "";

        setWordCount(12);
        setWords(testWords);
        toast({
            title: "Test Case Loaded (Ordered)",
            description: `A test wallet has been generated. The missing word is "${missingWord}". Click Start to test.`,
        });
    } else {
        const wordsToShuffle = [...testWords];
        const missingWord = wordsToShuffle.pop()!;
        // Shuffle the known words
        for (let i = wordsToShuffle.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [wordsToShuffle[i], wordsToShuffle[j]] = [wordsToShuffle[j], wordsToShuffle[i]];
        }
        setKnownWords(wordsToShuffle.join(' '));
        setMissingWordCount(1);
        toast({
            title: "Test Case Loaded (Unordered)",
            description: `A test wallet has been generated. Known words are filled in. The missing word is "${missingWord}". Click Start to test.`,
        });
    }

    setWordCount(12);
    setTargetAddress(wallet.address);
    setDerivationPath(DEFAULT_DERIVATION_PATH);
    setChildIndexes(10);
    setIsConfirmed(true);
    setLogs([]);
    setResult(null);
    setError(null);
    
    addLog("Test case loaded. Click 'Start Recovery' to begin.", "info");
  };

  const handleExport = () => {
    if (!result) return;
    const fileContent = `Seed Recovery BIP39 Result\n\n`
      + `Date: ${new Date().toISOString()}\n\n`
      + `WARNING: This file contains your private seed phrase. Keep it safe and offline.\n\n`
      + `-------------------------------------\n`
      + `Recovered Mnemonic: ${result.mnemonic}\n`
      + `Derivation Path: ${result.path}\n`
      + `Derived Address: ${result.address}\n`
      + `-------------------------------------\n`;
    
    const blob = new Blob([fileContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `seed-recovery-bip39-recovery-${new Date().getTime()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    addLog("Results exported to text file.", "info");
  };

  // --- Utility Functions ---
  const addLog = (message: string, type: "info" | "success" | "error" = "info") => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, `[${timestamp}] [${type.toUpperCase()}] ${message}`]);
  };
  
  const isBusy = status === "running" || status === "paused";
  const canStart = isConfirmed && !isBusy;

  // --- Render Logic ---
  return (
    <Card className="w-full max-w-4xl shadow-2xl">
      <CardHeader>
        <div className="flex items-center gap-4">
          <KeyRound className="h-10 w-10 text-primary" />
          <div>
            <CardTitle className="text-3xl font-bold">Seed Recovery BIP39</CardTitle>
            <CardDescription className="text-lg">Client-Side BIP39 Seed Phrase Recovery Tool</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle className="font-semibold">Security Warning!</AlertTitle>
          <AlertDescription>
            This tool runs entirely in your browser. No data is ever sent to a server. For maximum security, <strong>download this page and run it on an offline computer</strong>. Never enter your seed phrase on a website you do not trust.
          </AlertDescription>
        </Alert>

        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="how-to-use">
            <AccordionTrigger className="text-base font-semibold">
              <div className="flex items-center gap-2"><HelpCircle className="h-5 w-5" />How to Use & Security Info</div>
            </AccordionTrigger>
            <AccordionContent className="space-y-2 text-sm text-muted-foreground px-2">
              <p><strong>1. Choose Mode:</strong> Select 'Ordered' if you know the position of your words, or 'Unordered' if you don't.</p>
              <p><strong>2. Fill in Details:</strong> Enter your known words and the number of missing words. Provide a known wallet address for verification.</p>
              <p><strong>3. Confirm & Start:</strong> Check the ownership box and click 'Start Recovery'. The tool will begin searching.</p>
              <p><strong>4. Wait for Results:</strong> The process can take a long time. Progress will be displayed below. If found, the full seed will be shown.</p>
              <p><strong>Ethical Use:</strong> This tool is for personal wallet recovery ONLY. Unauthorized access to others' wallets is illegal and unethical.</p>
              <p><strong>Offline Use:</strong> Right-click this page -> "Save As" to download it. Disconnect from the internet and open the saved HTML file to use it securely offline.</p>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
        
        {/* --- Test Case Section --- */}
        <div className="p-4 border-dashed border rounded-lg bg-card">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <TestTube2 className="h-6 w-6 text-primary" />
              <div>
                <h3 className="font-semibold">Don't have a wallet to recover?</h3>
                <p className="text-sm text-muted-foreground">You can run a safe test case to see how the tool works.</p>
              </div>
            </div>
            <Button variant="secondary" onClick={handleRunTest}>
              <TestTube2 className="mr-2 h-4 w-4" />
              Load Test Case
            </Button>
          </div>
        </div>

        {/* --- Configuration --- */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <Label htmlFor="target-address" className="font-semibold text-base">Target Ethereum Address</Label>
            <Input id="target-address" placeholder="0x..." value={targetAddress} onChange={e => setTargetAddress(e.target.value)} disabled={isBusy} />
          </div>
          <div className="space-y-4">
            <Label className="font-semibold text-base">Seed Phrase Length</Label>
            <RadioGroup defaultValue="12" value={String(wordCount)} onValueChange={(v) => setWordCount(v === "12" ? 12 : 24)} className="flex gap-4 items-center" disabled={isBusy}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="12" id="r1" />
                <Label htmlFor="r1">12 Words</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="24" id="r2" />
                <Label htmlFor="r2">24 Words</Label>
              </div>
            </RadioGroup>
          </div>
          <div className="space-y-4">
            <Label htmlFor="derivation-path" className="font-semibold text-base">Derivation Path Base</Label>
            <Input id="derivation-path" value={derivationPath} onChange={e => setDerivationPath(e.target.value)} disabled={isBusy} />
          </div>
          <div className="space-y-4">
            <Label htmlFor="child-indexes" className="font-semibold text-base">Addresses to Check per Seed</Label>
            <Input id="child-indexes" type="number" min="1" max="1000" value={childIndexes} onChange={e => setChildIndexes(Math.min(1000, Number(e.target.value)))} disabled={isBusy} />
          </div>
        </div>

         {/* --- Recovery Mode --- */}
        <div>
          <Label className="font-semibold text-base">Recovery Mode</Label>
           <p className="text-sm text-muted-foreground mb-2">Choose 'Ordered' if you know the position of your words. Choose 'Unordered' if you only have a list of words.</p>
          <RadioGroup value={recoveryMode} onValueChange={(v) => setRecoveryMode(v as RecoveryMode)} className="flex gap-4 items-center" disabled={isBusy}>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="ordered" id="mode-ordered" />
              <Label htmlFor="mode-ordered">Ordered</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="unordered" id="mode-unordered" />
              <Label htmlFor="mode-unordered">Unordered</Label>
            </div>
          </RadioGroup>
        </div>


        {/* --- Mnemonic Input --- */}
        {recoveryMode === 'ordered' ? (
            <div>
              <Label className="font-semibold text-base mb-2 block">Seed Phrase (leave missing words blank)</Label>
              <div className={`grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4`}>
                {words.map((word, index) => (
                  <div key={index} className="relative">
                    <span className="absolute -left-5 top-2.5 text-xs text-muted-foreground font-mono">{index + 1}.</span>
                    <Input
                      type="text"
                      placeholder="????"
                      value={word}
                      onChange={e => handleWordChange(index, e.target.value)}
                      className="lowercase"
                      disabled={isBusy}
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck="false"
                    />
                  </div>
                ))}
              </div>
            </div>
        ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="md:col-span-2 space-y-2">
                    <Label htmlFor="known-words" className="font-semibold text-base">Known Words (space separated)</Label>
                    <Textarea 
                        id="known-words"
                        placeholder="abandon ability able about above..."
                        value={knownWords}
                        onChange={(e) => setKnownWords(e.target.value)}
                        disabled={isBusy}
                        className="h-32"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck="false"
                    />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="missing-word-count" className="font-semibold text-base">Number of Missing Words</Label>
                    <Input 
                        id="missing-word-count"
                        type="number"
                        min="1"
                        max="2"
                        value={missingWordCount}
                        onChange={(e) => setMissingWordCount(Math.min(2, Math.max(1, Number(e.target.value))))}
                        disabled={isBusy}
                    />
                </div>
            </div>
        )}

        {/* --- Controls --- */}
        <div className="space-y-4 pt-4 border-t">
            <div className="flex items-center space-x-2">
                <Checkbox id="terms" checked={isConfirmed} onCheckedChange={(checked) => setIsConfirmed(Boolean(checked))} disabled={isBusy} />
                <Label htmlFor="terms" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                I confirm I own this wallet and will not use this tool on others' wallets.
                </Label>
            </div>

            <div className="flex flex-wrap gap-4 items-center">
                <Button onClick={handleStart} disabled={!canStart} size="lg" className="bg-primary hover:bg-primary/90">
                    <Play className="mr-2 h-5 w-5" /> Start Recovery
                </Button>
                {status === "running" && <Button onClick={handlePause} variant="secondary" size="lg"><Pause className="mr-2 h-5 w-5" /> Pause</Button>}
                {status === "paused" && <Button onClick={handleResume} variant="secondary" size="lg"><Play className="mr-2 h-5 w-5" /> Resume</Button>}
                {isBusy && <Button onClick={handleStop} variant="destructive" size="lg"><StopCircle className="mr-2 h-5 w-5" /> Stop</Button>}
            </div>
        </div>
        
        {/* --- Progress & Results --- */}
        {(isBusy || status === "found" || status === "done" || error) && (
            <div className="space-y-4 pt-4 border-t">
                <h3 className="font-semibold text-lg">Progress & Results</h3>
                {isBusy && (
                  <div className="space-y-2">
                      <Progress value={(progress.attempts / progress.combinations) * 100} className="w-full" />
                      <div className="text-sm text-muted-foreground flex justify-between">
                          <span>{progress.attempts.toLocaleString()} / {progress.combinations.toLocaleString()} combinations tried</span>
                          <span>ETA: {progress.eta}</span>
                      </div>
                      {progress.currentWords.length > 0 && <p className="text-sm text-muted-foreground">Testing: {progress.currentWords.join(', ')}</p>}
                  </div>
                )}
                {status === 'running' && <div className="flex items-center gap-2 text-sm text-blue-600"><Loader2 className="animate-spin h-4 w-4" />Searching...</div>}
                {status === 'paused' && <div className="flex items-center gap-2 text-sm text-yellow-600"><Pause className="h-4 w-4" />Paused.</div>}
                {status === 'stopped' && <div className="flex items-center gap-2 text-sm text-red-600"><StopCircle className="h-4 w-4" />Stopped.</div>}
                {status === 'done' && <div className="flex items-center gap-2 text-sm text-gray-600"><CheckCircle2 className="h-4 w-4" />Finished. No match found.</div>}

                {error && <Alert variant="destructive"><AlertCircle className="h-4 w-4" /> <AlertTitle>Error</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}

                {result && (
                  <Card className="bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-green-700 dark:text-green-400"><CheckCircle2/> Recovery Successful!</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 font-mono bg-green-100/50 dark:bg-green-900/30 p-4 rounded-md">
                      <p><strong>Mnemonic:</strong> {result.mnemonic}</p>
                      <p><strong>Path:</strong> {result.path}</p>
                      <p><strong>Address:</strong> {result.address}</p>
                    </CardContent>
                    <CardFooter className="gap-4">
                        <Button onClick={handleExport}><Download className="mr-2 h-4 w-4" /> Export to .txt</Button>
                    </CardFooter>
                  </Card>
                )}

                <Label htmlFor="logs">Execution Log</Label>
                <Textarea id="logs" readOnly value={logs.join("\n")} className="h-48 font-mono text-xs" />
            </div>
        )}

      </CardContent>

      <CardFooter className="flex-col items-center gap-2 pt-6 text-center text-sm text-muted-foreground">
        <p>
          Built by <a href="https://github.com/rohitsenindia" target="_blank" rel="noopener noreferrer" className="underline hover:text-primary">Rohit Sen</a>.
        </p>
        <p>
          Verify the code on <a href="https://github.com/rohitsenindia/Seed-Recovery-BIP39" target="_blank" rel="noopener noreferrer" className="underline hover:text-primary">GitHub</a>.
        </p>
      </CardFooter>

      <AlertDialog open={showFullMnemonicWarning} onOpenChange={setShowFullMnemonicWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2"><FileWarning/> Full Seed Phrase Detected</AlertDialogTitle>
            <AlertDialogDescription>
              You appear to have entered a complete seed phrase. For your security, avoid pasting full, live seed phrases into any online tool, even this one.
              <br/><br/>
              This tool is for recovering <strong>missing</strong> words. If you are trying to access a wallet with a known seed, please use a trusted wallet application directly.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setShowFullMnemonicWarning(false)}>I Understand</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </Card>
  );
}

    