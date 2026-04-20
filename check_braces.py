import sys

def check_balanced_braces(filename):
    with open(filename, 'r', encoding='utf-8') as f:
        content = f.read()
    
    stack = []
    pairs = {'(': ')', '{': '}', '[': ']'}
    lines = content.split('\n')
    
    for i, line in enumerate(lines):
        for char in line:
            if char in '({[':
                stack.append((char, i+1))
            elif char in ')}]':
                if not stack:
                    print(f"Unmatched closing brace {char} at line {i+1}")
                    return False
                top, line_num = stack.pop()
                if pairs[top] != char:
                    print(f"Mismatched braces: {top} from line {line_num} with {char} at line {i+1}")
                    return False
    
    if stack:
        for char, line_num in stack:
            print(f"Unclosed brace {char} from line {line_num}")
        return False
    
    print("Braces are balanced.")
    return True

if __name__ == "__main__":
    check_balanced_braces(sys.argv[1])
