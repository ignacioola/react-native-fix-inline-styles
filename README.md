# react-native-fix-inline-styles

Experimental tool to fix inline styles in react native components.

### Setup & Run

1. `yarn global add jscodeshift`
1. `git clone https://github.com/ignacioola/react-native-fix-inline-styles.git`
1. Run `yarn install` in the **react-native-fix-inline-styles** directory
1. `jscodeshift -t react-native-fix-inline-styles/transforms/react-native-fix-inline-styles.js <path>`
   * `path` - files or directory to transform;
   * use the `-d` option for a dry-run and use `-p` to print the output for comparison;
   * use the `--extensions` option if your files have different extensions than `.js` (for example, `--extensions js,jsx`);
   * if you use flowtype, you might also need to use `--parser=flow`;
   * see all available [jscodeshift options](https://github.com/facebook/jscodeshift#usage-cli).
   
### Recommendations

* As this tool is experimental, before running have all your changes commited so you can compare the results.
