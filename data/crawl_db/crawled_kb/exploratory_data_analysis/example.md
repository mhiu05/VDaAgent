# Example

*Topic: Exploratory Data Analysis (https://en.wikipedia.org/wiki/Exploratory_data_analysis)*

Findings from EDA are orthogonal to the primary analysis task. To illustrate, consider an example from Cook et al. where the analysis task is to find the variables which best predict the tip that a dining party will give to the waiter. The variables available in the data collected for this task are: the tip amount, total bill, payer gender, smoking/non-smoking section, time of day, day of the week, and size of the party. The primary analysis task is approached by fitting a regression model where the tip rate is the response variable. The fitted model is

which says that as the size of the dining party increases by one person (leading to a higher bill), the tip rate will decrease by 1%, on average.

However, exploring the data reveals other interesting features not described by this model.

Histogram of tip amounts where the bins cover $1 increments. The distribution of values is skewed right and unimodal, as is common in distributions of small, non-negative quantities.
Histogram of tip amounts where the bins cover $0.10 increments. An interesting phenomenon is visible: peaks occur at the whole-dollar and half-dollar amounts, which is caused by customers picking round numbers as tips. This behavior is common to other types of purchases too, like gasoline.
Scatterplot of tips vs. bill. Points below the line correspond to tips that are lower than expected (for that bill amount), and points above the line are higher than expected. We might expect to see a tight, positive linear association, but instead see variation that increases with tip amount. In particular, there are more points far away from the line in the lower right than in the upper left, indicating that more customers are very cheap than very generous.
Scatterplot of tips vs. bill separated by payer gender and smoking section status. Smoking parties have a lot more variability in the tips that they give. Males tend to pay the (few) higher bills, and the female non-smokers tend to be very consistent tippers (with three conspicuous exceptions shown in the sample).

What is learned from the plots is different from what is illustrated by the regression model, even though the experiment was not designed to investigate any of these other trends. The patterns found by exploring the data suggest hypotheses about tipping that may not have been anticipated in advance, and which could lead to interesting follow-up experiments where the hypotheses are formally stated and tested by collecting new data.