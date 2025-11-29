# Seed Recovery BIP39 - Client-Side BIP39 Seed Phrase Recovery Tool

**Disclaimer:** This tool is intended for personal use to recover your own cryptocurrency wallet. Unauthorized access to another person's wallet is illegal and unethical. Use this tool responsibly and at your own risk.

## 🛡️ Security First: The Golden Rule

**NEVER run this tool on a computer connected to the internet with your real seed phrase.**

For maximum security, you should ALWAYS:
1.  **Download this application:** Right-click on the main page and select "Save As..." to save it as an HTML file.
2.  **Transfer to an Offline Computer:** Use a USB drive to move the saved file to a computer that is completely disconnected from the internet (air-gapped).
3.  **Run the Recovery:** Open the downloaded HTML file on the offline computer to perform the recovery process.
4.  **Clear Your Data:** Once you have recovered your phrase, securely wipe the file and any related data.

This tool is designed to run entirely within your web browser. **No data, including your words or addresses, is ever sent to a server.** However, the only way to be 100% certain of your security is to run it offline.

## ✨ Features

*   **Client-Side Operation:** All calculations happen locally in your browser. Nothing is ever transmitted over the network.
*   **Two Recovery Modes:**
    *   **Ordered Mode:** For when you know the exact position of your words but one or more are missing.
    *   **Unordered Mode:** For when you have a list of words but are unsure of their correct order or which one is missing.
*   **BIP39 Compliant:** Works with the standard BIP39 wordlist (English).
*   **Customizable Search:**
    *   Supports 12 and 24-word seed phrases.
    *   Configurable derivation path (defaults to the Ethereum standard `m/44'/60'/0'/0`).
    *   Specify the number of derived addresses to check against your target address.
*   **Web Worker Powered:** The intensive search process runs in a background thread, preventing the user interface from freezing.
*   **Safe Test Case:** Includes a button to load a temporary, non-sensitive test wallet so you can see how the tool works without using your own data.

## 🚀 How to Use

1.  **Follow the Security-First Rule:** Before anything else, download the page and move it to an offline computer.
2.  **Enter Target Address:** Paste the public Ethereum address of the wallet you are trying to recover. This is used to verify the correct seed phrase when found.
3.  **Set Configuration:**
    *   Choose the length of your seed phrase (12 or 24 words).
    *   Adjust the derivation path and number of addresses to check if you used a non-standard setup. The defaults work for most wallets (like MetaMask, Trust Wallet, etc.).
4.  **Choose Recovery Mode:**
    *   **Ordered:** If you know the word positions, leave the inputs for the missing words blank.
    *   **Unordered:** If you don't know the word order, enter all the words you know (separated by spaces) into the "Known Words" text area and specify how many words are missing.
5.  **Acknowledge and Start:**
    *   Check the box to confirm you own the wallet.
    *   Click the "Start Recovery" button.
6.  **Wait for Results:** The recovery process can take a significant amount of time, from minutes to hours or even days, depending on the number of missing words and the speed of your computer.
    *   The progress bar will show the estimated time and completion status.
    *   The execution log will provide real-time updates on the search.
7.  **Success!** If the correct phrase is found, it will be displayed prominently in the "Recovery Successful" section. You can then export the results to a text file.

## 🛠️ Technology Stack

*   **Next.js & React:** For the user interface.
*   **ethers.js:** For handling wallet creation, derivation, and address generation from seed phrases.
*   **bip39:** For mnemonic phrase generation and validation.
*   **Web Workers:** To run the computationally intensive search without freezing the browser.
*   **Tailwind CSS & ShadCN UI:** For styling and components.
