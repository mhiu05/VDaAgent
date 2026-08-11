# Main data analysis

*Topic: Data Analysis (https://en.wikipedia.org/wiki/Data_analysis)*

In the main analysis phase, analyses aimed at answering the research question are performed as well as any other relevant analysis needed to write the first draft of the research report.

In the main analysis phase, either an exploratory or confirmatory approach can be adopted. Usually the approach is decided before data is collected. In an exploratory analysis no clear hypothesis is stated before analysing the data, and the data is searched for models that describe the data well. In a confirmatory analysis, clear hypotheses about the data are tested.

Exploratory data analysis should be interpreted carefully. When testing multiple models at once there is a high chance on finding at least one of them to be significant, but this can be due to a type 1 error. It is important to always adjust the significance level when testing multiple models with, for example, a Bonferroni correction. Also, one should not follow up an exploratory analysis with a confirmatory analysis in the same dataset. An exploratory analysis is used to find ideas for a theory, but not to test that theory as well. When a model is found exploratory in a dataset, then following up that analysis with a confirmatory analysis in the same dataset could simply mean that the results of the confirmatory analysis are due to the same type 1 error that resulted in the exploratory model in the first place. The confirmatory analysis therefore will not be more informative than the original exploratory analysis.

It is important to obtain some indication about how generalizable the results are. While this is often difficult to check, one can look at the stability of the results. Are the results reliable and reproducible? There are two main ways of doing that.

Cross-validation. By splitting the data into multiple parts, we can check if an analysis (like a fitted model) based on one part of the data generalizes to another part of the data as well. Cross-validation is generally inappropriate, though, if there are correlations within the data, e.g. with panel data. Hence other methods of validation sometimes need to be used. For more on this topic, see statistical model validation.
Sensitivity analysis. A procedure to study the behavior of a system or model when global parameters are (systematically) varied. One way to do that is via bootstrapping.