import re

def validate_jsx(file_path):
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Simple regex to find tags and blocks
    # This is very rough but might help
    tags = re.findall(r'<([a-zA-Z0-9]+)|</([a-zA-Z0-9]+)>|(\{)|(\})|(\()|(\))', content)
    
    stack = []
    line_no = 1
    col_no = 1
    
    # We need to find where tags are in the file to report line numbers
    # But let's just count for now
    
    div_count = 0
    block_count = 0
    paren_count = 0
    
    for i, line in enumerate(content.split('\n')):
        # Count divs in this line
        div_open = line.count('<div')
        div_close = line.count('</div>')
        div_count += div_open
        div_count -= div_close
        
        # Count blocks
        block_open = line.count('{')
        block_close = line.count('}')
        block_count += block_open
        block_count -= block_close
        
        # Count parens
        paren_open = line.count('(')
        paren_close = line.count(')')
        paren_count += paren_open
        paren_count -= paren_close
        
        if div_count < 0 or block_count < 0 or paren_count < 0:
            print(f"Negative count at line {i+1}: div={div_count}, block={block_count}, paren={paren_count}")
            # Reset to avoid cascade
            if div_count < 0: div_count = 0
            if block_count < 0: block_count = 0
            if paren_count < 0: paren_count = 0

    print(f"Final counts: div={div_count}, block={block_count}, paren={paren_count}")

validate_jsx(r'c:\Users\valer\OneDrive\Escritorio\Workspace\OzyBase\frontend\src\components\CreateTableModal.tsx')
