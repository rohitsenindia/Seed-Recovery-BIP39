# **App Name**: Seed Savior

## Core Features:

- BIP39 Phrase Input: Allows users to input known words from their BIP39 seed phrase and mark the missing positions, supporting up to two missing words.
- Address Input: Requires the user to enter a known address derived from the target seed phrase for verification.
- Word Recovery Tool: Uses the provided known words and missing positions to systematically try all possible BIP39 word combinations. Validates the mnemonic phrase.
- Address Verification: Compares the generated addresses from the recovered seed phrases with the user-provided address to confirm a match.
- Result Display: Presents the recovered seed phrase and the matching address upon successful verification.

## Style Guidelines:

- Primary color: Deep blue (#3F51B5) to convey security and trust, relating to the seriousness of seed recovery.
- Background color: Light gray (#ECEFF1) to provide a clean and neutral backdrop, reducing visual noise.
- Accent color: A contrasting orange (#FF9800) to highlight key actions and results, drawing attention to successful recoveries.
- Font: 'Inter', a grotesque-style sans-serif with a modern, machined, objective, neutral look; suitable for both headlines and body text.
- Clean and straightforward layout with clear input fields for known words, missing positions, and the target address.
- Use simple, consistent icons to represent actions and states, such as a key icon for seed phrase input and a checkmark for successful verification.