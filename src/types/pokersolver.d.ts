declare module 'pokersolver' {
  export type SolvedPokerHand = {
    name: string
    descr: string
    rank: number
    cards: Array<{ toString(): string }>
  }

  export type PokerSolverModule = {
    Hand: {
      solve(cards: string[], game?: string, canDisqualify?: boolean): SolvedPokerHand
      winners(hands: SolvedPokerHand[]): SolvedPokerHand[]
    }
  }

  const pokerSolver: PokerSolverModule
  export default pokerSolver
}
