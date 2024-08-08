```typescript
function func1(x: number, y: number, op: string): number {
  switch (
    op // 2
  ) {
    default: // 3
      throw Error(`Unknown operator: ${op}`); // 4
    case "+": // 5
      return x + y; // 6
    case "-": // 7
      return x - y; // 8
    case "*": // 9
      return x * y; // 10
    case "/": // 11
      return x / y; // 12
    case "^": // 13
      return x ^ y; // 14
    case "%": // 15
      return x % y; // 16
    case "--": // 17
      return func1(toStringX(x), func1(x, func2(y), "*")); // 18
  }
}
```
