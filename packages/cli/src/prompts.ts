import { createInterface } from "node:readline"
import { stdin as input, stdout as output } from "node:process"

/**
 * Minimal interactive prompt. Business logic never lives here — prompts only
 * collect input and hand it to the command implementations.
 */
export async function prompt(question: string, defaultValue?: string): Promise<string> {
  const rl = createInterface({ input, output })
  try {
    const suffix = defaultValue !== undefined ? ` [${defaultValue}]` : ""
    const answer = await new Promise<string>((resolve) => {
      rl.question(`${question}${suffix}: `, resolve)
    })
    return answer.trim() || (defaultValue ?? "")
  } finally {
    rl.close()
  }
}
