# Analyzing quantitative data in finance

*Topic: Data Analysis (https://en.wikipedia.org/wiki/Data_analysis)*

Author Jonathan Koomey has recommended a series of best practices for understanding quantitative data. These include:

Check raw data for anomalies prior to performing an analysis;
Re-perform important calculations, such as verifying columns of data that are formula-driven;
Confirm main totals are the sum of subtotals;
Check relationships between numbers that should be related in a predictable way, such as ratios over time;
Normalize numbers to make comparisons easier, such as analyzing amounts per person or relative to GDP or as an index value relative to a base year;
Break problems into component parts by analyzing factors that led to the results, such as DuPont analysis of return on equity.

For the variables under examination, analysts typically obtain descriptive statistics, such as the mean (average), median, and standard deviation. They may also analyze the distribution of the key variables to see how the individual values cluster around the mean.

McKinsey and Company named a technique for breaking down a quantitative problem into its component parts called the MECE principle. MECE means "Mutually Exclusive and Collectively Exhaustive". Each layer can be broken down into its components; each of the sub-components must be mutually exclusive of each other and collectively add up to the layer above them.  For example, profit by definition can be broken down into total revenue and total cost.

Analysts may use robust statistical measurements to solve certain analytical problems.  Hypothesis testing is used when a particular hypothesis about the true state of affairs is made by the analyst and data is gathered to determine whether that hypothesis is true or false. For example, the hypothesis might be that "Unemployment has no effect on inflation", which relates to an economics concept called the Phillips Curve. Hypothesis testing involves considering the likelihood of Type I and type II errors, which relate to whether the data supports accepting or rejecting the hypothesis.

Regression analysis may be used when the analyst is trying to determine the extent to which independent variable X affects dependent variable Y (e.g., "To what extent do changes in the unemployment rate (X) affect the inflation rate (Y)?").

Necessary condition analysis (NCA) may be used when the analyst is trying to determine the extent to which independent variable X allows variable Y (e.g., "To what extent is a certain unemployment rate (X) necessary for a certain inflation rate (Y)?"). Whereas (multiple) regression analysis uses additive logic where each X-variable can produce the outcome and the X's can compensate for each other (they are sufficient but not necessary), necessary condition analysis (NCA) uses necessity logic, where one or more X-variables allow the outcome to exist, but may not produce it (they are necessary but not sufficient). Each single necessary condition must be present and compensation is not possible.